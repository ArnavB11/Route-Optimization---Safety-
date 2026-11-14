"""Reproducible ingestion of professor-supplied GPS surveys; no crash inference."""
import csv
import hashlib
import json
import math
from datetime import datetime
from pathlib import Path
import xml.etree.ElementTree as ET
import numpy as np

ROOT = Path(__file__).resolve().parents[1] / 'datasets' / 'field_surveys'
FILES = [
 ('ne04', 'Ena toll to Dehgam · NE04', 'Ena toll to Dehgam NE04 (1).csv', 'Ena_toll_to_Dehgam_Toll_NE04.kml'),
 ('ne01', 'Vadodara to Anand · NE01', 'Vadodara to Anand NE01 (1).csv', 'Vadodara_to_Anand_NE01.kml'),
 ('nh48', 'Narmada bridge to Kamrej · NH48', 'Narmada bridge to Kamrej NH48.csv', 'Narmada_bridge_toll_to_Kamrej_NH48 (1).kml'),
 ('nh53', 'Mandal / Manal to Bhatia · NH53', 'Mandal to Bhatia NH53 (2).csv', 'Manal_toll_to_Bhatia_Toll_NH53.kml'),
]

def distance(a, b):
    lat = math.radians((a[1]+b[1])/2)
    return math.hypot(math.radians(b[0]-a[0])*math.cos(lat), math.radians(b[1]-a[1])) * 6371008.8

def load(csv_path, kml_path, key, name):
    with csv_path.open(encoding='utf-8-sig', newline='') as stream:
        rows = list(csv.DictReader(stream))
    points, rejected = [], 0
    for line, row in enumerate(rows, 2):
        try:
            lon, lat, speed, accuracy = [float(row[k]) for k in ('Lng','Lat','SpeedKPH','Acc')]
            stamp = datetime.fromisoformat(row['Time'].replace('Z','+00:00'))
            if stamp.tzinfo is None:
                raise ValueError('UTC offset required')
            bearing = float(row['Bearing'])
            if not all(map(math.isfinite, (lon,lat,speed,accuracy,bearing))) or not (-180 <= lon <=180 and -90<=lat<=90 and 0<=speed<=200 and 0<accuracy<=25):
                raise ValueError('invalid measurement')
            points.append(dict(lon=lon,lat=lat,speed=speed,accuracy=accuracy,time=stamp.timestamp(),bearing=bearing,line=line))
        except (KeyError, ValueError, TypeError):
            rejected += 1
    if not points:
        raise ValueError(f'No usable points in {csv_path}')
    tree = ET.parse(kml_path)
    coords = [list(map(float, x.text.split()))[:2] for x in tree.findall('.//{*}Track/{*}coord')]
    if not coords:
        raise ValueError('KML has no track coordinates')
    # KML is a separate export, retained intact and cross-checked by timestamp.
    times = tree.findall('.//{*}Track/{*}when')
    kml_by_time = {datetime.fromisoformat(t.text.replace('Z','+00:00')).timestamp(): c for t,c in zip(times,coords)}
    offsets = [distance([p['lon'],p['lat']],kml_by_time[p['time']]) for p in points if p['time'] in kml_by_time]
    runs, current, events, samples = [], [], [], []
    elapsed, metres, gaps, discontinuities = 0., 0., 0, 0
    bins = {}
    for i,p in enumerate(points):
        if i:
            prev = points[i-1]
            dt = p['time']-prev['time']
            ds = distance([prev['lon'],prev['lat']],[p['lon'],p['lat']])
            valid = 0 < dt <= 5 and ds/dt <= 60
            if not valid:
                if current: runs.append(current)
                current = []
                gaps += int(dt>5)
                discontinuities += int(dt<=0 or (dt>0 and ds/dt>60))
            else:
                elapsed += dt; metres += ds
                acceleration = (p['speed']-prev['speed'])/3.6/dt
                if acceleration <= -3 and prev['speed']>=20 and (not events or p['time']-events[-1]['epoch']>5):
                    events.append(dict(lon=p['lon'],lat=p['lat'],epoch=p['time'],time=datetime.fromtimestamp(p['time'],tz=stamp.tzinfo).isoformat(),deceleration_m_s2=round(acceleration,2),speed_before_kph=prev['speed'],speed_after_kph=p['speed']))
        current.append([p['lon'],p['lat']])
        bucket = int(metres//1000)
        bins.setdefault(bucket,[]).append(p['speed'])
        samples.append([p['lon'],p['lat'],p['speed'],p['bearing']])
    if current: runs.append(current)
    # Decimate display geometry only; preserve run boundaries and endpoints.
    geometry = [run[::5]+([run[-1]] if len(run)>1 and (len(run)-1)%5 else []) for run in runs if len(run)>=2]
    return dict(id=key,name=name,source='Professor-supplied car GPS recording',mode='car',
        files=[dict(name=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in (csv_path,kml_path)],
        quality=dict(input_rows=len(rows),accepted_rows=len(points),rejected_rows=rejected,recording_gaps=gaps,discontinuities=discontinuities,kml_points=len(coords),kml_timestamp_matches=len(offsets),kml_median_offset_m=round(float(np.median(offsets)),2) if offsets else None),
        start_utc=datetime.fromtimestamp(points[0]['time'],tz=stamp.tzinfo).isoformat(),end_utc=datetime.fromtimestamp(points[-1]['time'],tz=stamp.tzinfo).isoformat(),
        distance_km=round(metres/1000,2),recorded_duration_min=round(elapsed/60,1),median_speed_kph=round(float(np.median([p['speed'] for p in points])),1),p85_speed_kph=round(float(np.percentile([p['speed'] for p in points],85)),1),
        geometry=geometry,braking_candidates=events,samples=samples,
        speed_profile=[dict(km=k,median_kph=round(float(np.median(v)),1),samples=len(v)) for k,v in sorted(bins.items())])

def main():
    surveys=[load(ROOT/'source'/c,ROOT/'source'/k,key,name) for key,name,c,k in FILES]
    result=dict(version=1,surveys=surveys)
    (ROOT/'surveys.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    for s in surveys:
        print(s['id'],s['distance_km'],s['quality'], 'braking candidates',len(s['braking_candidates']))

if __name__=='__main__': main()

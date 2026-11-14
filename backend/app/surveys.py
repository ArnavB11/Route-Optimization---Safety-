"""Survey catalogue and conservative, direction-aware route evidence matching."""
import json
import math
from functools import lru_cache
import numpy as np
from scipy.spatial import cKDTree
from .config import DATASETS_DIR

@lru_cache(maxsize=1)
def catalogue():
    path=DATASETS_DIR/'field_surveys'/'surveys.json'
    return json.loads(path.read_text(encoding='utf-8'))['surveys'] if path.exists() else []

def public_surveys():
    return {'surveys': [{k:v for k,v in row.items() if k!='samples'} for row in catalogue()]}

def xy(coords):
    coords=np.asarray(coords,dtype=float)
    return coords*np.array([111195*math.cos(math.radians(22)),111195])

@lru_cache(maxsize=1)
def indexes():
    return [(s,cKDTree(xy(np.asarray(s['samples'])[:,:2])),np.asarray(s['samples'])) for s in catalogue() if s['samples']]

def route_evidence(coords,mode):
    if mode!='car' or len(coords)<2:
        return []
    pts=xy(coords); midpoints=[]; lengths=[]; bearings=[]
    for a,b in zip(pts[:-1],pts[1:]):
        delta=b-a; length=float(np.linalg.norm(delta))
        if length<.01: continue
        count=max(1,math.ceil(length/25))
        for i in range(count):
            midpoints.append(a+delta*((i+.5)/count)); lengths.append(length/count)
            bearings.append(math.degrees(math.atan2(delta[0],delta[1]))%360)
    if not midpoints:return []
    lengths=np.asarray(lengths); bearings=np.asarray(bearings); evidence=[]
    for survey,tree,samples in indexes():
        dist,idx=tree.query(midpoints)
        angle=np.abs((samples[idx,3]-bearings+180)%360-180)
        keep=(dist<=30)&(angle<=45)
        matched=float(lengths[keep].sum())
        if matched<100: continue
        evidence.append(dict(id=survey['id'],name=survey['name'],matched_km=round(matched/1000,2),recorded_median_kph=round(float(np.median(samples[idx[keep],2])),1),source='Single recorded car trip; proximity match, not a verified road match'))
    return evidence

import math
from pathlib import Path
import pytest
from app.surveys import catalogue, public_surveys, route_evidence
from pipeline.import_surveys import load, ROOT, FILES

def test_all_supplied_files_accounted_for():
    surveys=catalogue()
    assert len(surveys)==4
    assert sum(s['quality']['input_rows'] for s in surveys)==16335
    assert sum(s['quality']['rejected_rows'] for s in surveys)==7
    for s in surveys:
        assert len(s['files'])==2
        assert s['quality']['kml_timestamp_matches']>0
        assert s['quality']['kml_median_offset_m'] is not None
        assert s['geometry'] and all(len(run)>=2 for run in s['geometry'])
        assert 0<s['distance_km']<200
        assert s['quality']['accepted_rows']+s['quality']['rejected_rows']==s['quality']['input_rows']

@pytest.mark.parametrize('key,name,csv,kml', FILES)
def test_raw_import_is_reproducible(key,name,csv,kml):
    expected=next(s for s in catalogue() if s['id']==key)
    assert load(ROOT/'source'/csv,ROOT/'source'/kml,key,name)==expected

def test_quality_gaps_are_not_connected():
    survey=next(s for s in catalogue() if s['id']=='nh53')
    assert survey['quality']['recording_gaps']>100
    assert len(survey['geometry'])>1
    assert survey['recorded_duration_min']<200

def test_route_evidence_requires_car_nearby_and_same_direction():
    survey=catalogue()[0]
    coords=survey['geometry'][0][:20]
    assert route_evidence(coords,'car')
    assert route_evidence(coords,'walk')==[]
    assert route_evidence(coords,'two_wheeler')==[]
    assert route_evidence([[0,0],[.01,.01]],'car')==[]
    assert route_evidence(coords[::-1],'car')==[]

def test_public_catalogue_does_not_send_full_resolution_samples():
    assert all('samples' not in s for s in public_surveys()['surveys'])
    assert all(math.isfinite(s['median_speed_kph']) for s in public_surveys()['surveys'])


def test_gap_excluded_from_distance_duration_and_geometry(tmp_path):
    csv_path=tmp_path/'trace.csv'
    csv_path.write_text('Lat,Lng,SpeedKPH,Acc,Time,Bearing\n22,73,36,3,2026-07-25T00:00:00Z,90\n22,73.0001,36,3,2026-07-25T00:00:01Z,90\n22,73.1,36,3,2026-07-25T00:01:00Z,90\n22,73.1001,36,3,2026-07-25T00:01:01Z,90\n')
    kml_path=tmp_path/'trace.kml'
    kml_path.write_text('<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><gx:Track><gx:coord>73 22 0</gx:coord></gx:Track></kml>')
    result=load(csv_path,kml_path,'test','Test')
    assert len(result['geometry'])==2
    assert result['quality']['recording_gaps']==1
    assert result['distance_km']<.03
    assert result['recorded_duration_min']<.1


def test_car_route_response_attaches_field_evidence():
    from app import api
    # Interior highway points from the NE01 recording, inside the Vadodara graph.
    origin,destination=[73.17404,22.38590],[73.16218,22.39961]
    result=api.route({'origin':{'lat':origin[1],'lon':origin[0]},'destination':{'lat':destination[1],'lon':destination[0]},'include_analysis':False})
    assert any(r['field_surveys'] for r in result['routes'].values())

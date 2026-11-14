"""Navigation relies on distinct manoeuvres and monotonic path offsets."""
from types import SimpleNamespace
import numpy as np
from app import model as M
from app.directions import directions


def test_roundabout_entry_exit_and_arrival_have_separate_offsets():
    arrays = {
        'edge_seg': np.array([0, 1, 2]), 'seg_name': np.array([0, 1, 2]),
        'edge_b_start': np.array([0., 90., 90.]), 'edge_b_end': np.array([0., 90., 90.]),
        'node_lat': np.array([22., 22.001, 22.002, 22.003]),
        'node_lon': np.array([73., 73.001, 73.002, 73.003]),
        'node_degree': np.array([1, 3, 3, 1]),
        'node_roundabout': np.array([False, True, False, False]),
    }
    graph = SimpleNamespace(a=arrays, names=['Approach', 'Circle', 'Exit Road'],
        e_len=np.array([100., 100., 100.]), e_cls=np.array([M.CLASS_ID['residential']]*3),
        lg={'car': SimpleNamespace(t_node=np.array([1, 2]), t_type=np.array([M.TURN_STRAIGHT]*2))})
    path = SimpleNamespace(edges=[0, 1, 2], trans=[0, 1], nodes=[0, 1, 2, 3])
    costs = SimpleNamespace(edge_time=np.array([10., 10., 10.]), trans_time=np.zeros(2),
        edge_risk=np.ones(3), trans_risk=np.zeros(2), ref_risk_per_km=1.)
    steps = directions(graph, path, costs, 'car')
    assert [s['type'] for s in steps] == ['depart', 'roundabout', 'exit_roundabout', 'arrive']
    assert [s['distance_from_start_m'] for s in steps] == [0, 100, 200, 300]
    assert steps[1]['text'] == 'Enter the roundabout'
    assert steps[2]['text'] == 'Leave the roundabout onto Exit Road'
    assert sum(s['distance_m'] for s in steps) == 300
    assert sum(s['time_s'] for s in steps) == 30

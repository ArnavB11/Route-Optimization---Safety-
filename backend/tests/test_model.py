import numpy as np

from app import model as M


def test_severity_reference_and_monotonic():
    assert abs(M.severity(40.0) - 1.0) < 1e-12
    v = np.linspace(10, 100, 50)
    assert np.all(np.diff(M.severity(v)) > 0)
    # fatal term grows with the 4th power: doubling speed > 4x harm
    assert M.severity(80.0) > 4 * M.severity(40.0)


def test_pedestrian_fatality_curve():
    # Rosén & Sander (2009): ~2.5 % at 30 km/h, ~8 % at 50 km/h, ~30 % at 65 km/h
    assert 0.01 < M.pedestrian_fatality(30) < 0.04
    assert 0.06 < M.pedestrian_fatality(50) < 0.12
    assert 0.25 < M.pedestrian_fatality(65) < 0.40


def test_time_of_day_risk_is_traffic_weighted_unit_mean():
    w = M.TRAFFIC_SHARE_3H / M.TRAFFIC_SHARE_3H.sum()
    assert abs(np.sum(M.TOD_RISK_3H * w) - 1.0) < 1e-9
    assert M.time_of_day_risk(2) > M.time_of_day_risk(10)   # night riskier per vkm


def test_darkness():
    assert M.darkness(12) == 0.0
    assert M.darkness(23) == 1.0
    assert 0 < M.darkness(18.75) < 1


def test_turn_types_left_hand_traffic():
    t = M.turn_type([0, 10, -90, 90, 179, -170])
    assert list(t) == [M.TURN_STRAIGHT, M.TURN_STRAIGHT, M.TURN_LEFT, M.TURN_RIGHT, M.TURN_UTURN, M.TURN_UTURN]
    assert M.TURN_RISK[M.TURN_RIGHT] > M.TURN_RISK[M.TURN_STRAIGHT] > M.TURN_RISK[M.TURN_LEFT]


def test_bpr_and_webster():
    assert M.bpr_factor(1.0, 3) < M.bpr_factor(1.0, 9)       # night < peak
    assert abs(M.bpr_factor(1.0, 9) - 1.15) < 1e-9            # BPR at v/c = 1
    assert M.webster_delay(0.9) > M.webster_delay(0.3) > 0


def test_security_index_bounds():
    s = M.security_index(np.array([0.0, 1.0]), np.array([0.0, 1.0]), np.array([5000.0, 0.0]),
                         np.array([0.0, 1.0]), 1.0)
    assert 0 <= s[1] < s[0] <= 1

"""MM 봇 유닛 테스트 (가격 피드 없이 순수 로직)."""

from decimal import Decimal

from src.mm_bot.order_gen import bid_ask_prices
from src.mm_bot.price_feed import BinanceWsFeed, _parse_book_ticker
from src.mm_bot.spread import SpreadCalculator, SpreadConfig


def test_bid_ask_symmetric_spread() -> None:
    bid, ask = bid_ask_prices(600.0, 100.0)
    assert bid < Decimal("600")
    assert ask > Decimal("600")
    mid = (bid + ask) / 2
    assert abs(mid - Decimal("600")) < Decimal("0.01")


def test_spread_volatility_increases_bps() -> None:
    base_bps = 30.0
    calc = SpreadCalculator(
        SpreadConfig(base_bps=base_bps, min_bps=10.0, max_bps=200.0, vol_window_sec=60.0)
    )
    # hi=101, lo=99, range≈2% → multiplier≈3.0 → effective≈90bps
    t = 0.0
    for p in (100.0, 100.5, 101.0, 99.0, 100.0):
        t += 1.0
        calc.record_mid(t, p)
    eff = calc.effective_spread_bps()
    # 변동성 승수가 실제로 작동했는지 확인 — base_bps 보다 엄격히 커야 한다.
    assert eff > base_bps
    assert eff >= base_bps * 2.0


def test_parse_book_ticker_valid() -> None:
    raw = '{"u":400900217,"s":"BNBUSDT","b":"600.00","B":"1.5","a":"600.10","A":"1.2"}'
    mid = _parse_book_ticker(raw)
    assert mid is not None
    assert abs(mid - 600.05) < 1e-9


def test_parse_book_ticker_bytes_payload() -> None:
    raw = b'{"b":"100.0","a":"102.0"}'
    assert _parse_book_ticker(raw) == 101.0


def test_parse_book_ticker_rejects_malformed() -> None:
    assert _parse_book_ticker("not json") is None
    assert _parse_book_ticker('{"u":1}') is None  # b, a 누락
    assert _parse_book_ticker('{"b":"abc","a":"1"}') is None  # float 파싱 실패
    assert _parse_book_ticker('{"b":"0","a":"0"}') is None  # 0 가격 거절
    assert _parse_book_ticker('{"b":"-1","a":"1"}') is None  # 음수 거절
    assert _parse_book_ticker("[1, 2, 3]") is None  # dict 아님
    assert _parse_book_ticker('{"b":"101.0","a":"100.0"}') is None  # crossed (bid > ask)


def test_binance_ws_cache_fresh_vs_stale() -> None:
    feed = BinanceWsFeed(stale_threshold_sec=5.0)

    # 테스트 전용 시계 주입
    now = [100.0]
    feed._now = lambda: now[0]  # type: ignore[method-assign]

    # cache miss
    assert feed.latest("BNB/USDT") is None

    # cache put
    feed._cache["BNB/USDT"] = (600.0, 100.0)
    assert feed.latest("BNB/USDT") == 600.0

    # 4.9s 경과 → 여전히 fresh
    now[0] = 104.9
    assert feed.latest("BNB/USDT") == 600.0

    # 5.1s 경과 → stale
    now[0] = 105.1
    assert feed.latest("BNB/USDT") is None


def test_binance_ws_subscribe_unknown_pair_rejected() -> None:
    feed = BinanceWsFeed()
    assert feed.subscribe("UNKNOWN/PAIR") is False
    assert "UNKNOWN/PAIR" not in feed._subs


def test_binance_ws_subscribe_known_pair() -> None:
    feed = BinanceWsFeed()
    assert feed.subscribe("BNB/USDT") is True
    assert feed._subs["BNB/USDT"] == "bnbusdt"

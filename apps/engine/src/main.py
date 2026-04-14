"""T-LAYER TEE Backend — FastAPI entrypoint."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.mm_bot.bot import MMBot
from src.mm_bot.config import load_mm_settings
from src.models import OrderBook
from src.routes import router
from src.ws import ConnectionManager

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.orderbook = OrderBook()
    app.state.ws_manager = ConnectionManager()
    app.state.background_tasks: set[asyncio.Task] = set()
    app.state.mm_bot = None

    mm_settings = load_mm_settings()
    if mm_settings.enabled:
        mm_bot = MMBot(
            settings=mm_settings,
            orderbook=app.state.orderbook,
            ws_manager=app.state.ws_manager,
        )
        app.state.mm_bot = mm_bot
        mm_task = asyncio.create_task(mm_bot.run_forever())
        app.state.background_tasks.add(mm_task)
        mm_task.add_done_callback(app.state.background_tasks.discard)
        logger.info("MM 봇 태스크 등록됨 (mm_config.yaml enabled=true)")

    yield

    mm = getattr(app.state, "mm_bot", None)
    if mm is not None:
        mm.stop()

    # 백그라운드 태스크 정리
    tasks: set[asyncio.Task] = getattr(app.state, "background_tasks", set())
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("백그라운드 태스크 %d건 정리 완료", len(tasks))


app = FastAPI(
    title="T-LAYER TEE Engine",
    description="TEE 기반 프라이버시 OTC 매칭 엔진",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

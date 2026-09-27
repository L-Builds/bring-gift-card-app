"""Local FastAPI launcher, including psycopg-compatible Windows asyncio loop."""
import asyncio
import os
import sys
import uvicorn

if __name__ == '__main__':
    config = uvicorn.Config('server:app', host='127.0.0.1', port=int(os.environ.get('PORT', '8000')),
                            access_log=False)
    server = uvicorn.Server(config)
    asyncio.run(server.serve(), loop_factory=asyncio.SelectorEventLoop if sys.platform == 'win32' else None)

@echo off
setlocal
cd /d "%~dp0"

call .venv\Scripts\activate.bat
start "" http://127.0.0.1:8787
python -m uvicorn app:app --host 127.0.0.1 --port 8787 --reload

pause

# Pin Python 3.12 INSIDE the container regardless of the host's Python.
# Your Mac has 3.14 (very new — some data libs lag behind it). Containers let
# us freeze a known-good runtime so the project behaves identically anywhere.
FROM python:3.12-slim

WORKDIR /app

# Copy only requirements first, then install. Docker caches each layer; as long
# as requirements.txt is unchanged, `docker compose up` reuses the cached
# install instead of re-downloading every time — a core Docker speed trick.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Source is bind-mounted in docker-compose for live reload, so we don't COPY it
# here for development.

EXPOSE 8081

# --reload = uvicorn watches files and restarts on change (dev convenience).
# --host 0.0.0.0 = listen on all interfaces INSIDE the container, so the port
# mapping in docker-compose can reach it from your Mac.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8081", "--reload"]

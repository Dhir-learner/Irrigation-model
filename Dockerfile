FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project source
COPY . .

# Build React frontend
WORKDIR /app/frontend
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps
RUN npm run build

# Go back to app root
WORKDIR /app

# Train model only if the committed artifact is missing, so the deployed model
# matches the reports and validation figures shipped with the repo.
RUN test -f models/soil_moisture_pipeline.joblib || python -m src.train

# Expose port 7860 for HuggingFace Spaces
EXPOSE 7860

# FastAPI serves both API and the built frontend at /app/
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "7860"]

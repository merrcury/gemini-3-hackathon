# 2nd Brain — Backend Services

Backend infrastructure for the 2nd Brain app. Three components:

| Service | Runtime | Purpose |
|---|---|---|
| **Mem0 Stack** (Qdrant + Neo4j + Mem0 UI) | Compute Engine (e2-medium) | Vector + graph memory storage |
| **Mem0 Connector API** | Cloud Run | FastAPI proxy to Mem0 stack with Clerk JWT auth |
| **Preferences API** | Cloud Run | User preferences stored in MongoDB with Clerk JWT auth |

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud                                                    │
│                                                                  │
│  ┌─────────────────────┐     ┌──────────────────────────────┐   │
│  │  Cloud Run           │     │  Compute Engine (e2-medium)   │   │
│  │                     │     │                              │   │
│  │  ┌───────────────┐  │     │  ┌────────┐  ┌───────────┐  │   │
│  │  │ Mem0 Connector │──┼─────┼──│ Qdrant │  │  Neo4j    │  │   │
│  │  │ :8080          │  │     │  │ :6333  │  │  :7687    │  │   │
│  │  └───────────────┘  │     │  └────────┘  └───────────┘  │   │
│  │                     │     │                              │   │
│  │  ┌───────────────┐  │     │  ┌────────────────────────┐  │   │
│  │  │ Preferences   │  │     │  │  Mem0 API + UI         │  │   │
│  │  │ API :8080     │  │     │  │  :8888 / :3000         │  │   │
│  │  └───────┬───────┘  │     │  └────────────────────────┘  │   │
│  └──────────┼──────────┘     └──────────────────────────────┘   │
│             │                                                    │
│  ┌──────────▼──────────┐                                        │
│  │  MongoDB Atlas       │                                        │
│  └─────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Variables Reference](#environment-variables-reference)
3. [Part 1 — Deploy Mem0 Stack on e2-medium VM](#part-1--deploy-mem0-stack-on-e2-medium-vm)
4. [Part 2 — Deploy Mem0 Connector API to Cloud Run](#part-2--deploy-mem0-connector-api-to-cloud-run)
5. [Part 3 — Deploy Preferences API to Cloud Run](#part-3--deploy-preferences-api-to-cloud-run)
6. [Verify Deployment](#verify-deployment)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed and authenticated
- A GCP project with billing enabled
- Docker installed locally (for testing)
- [Clerk](https://clerk.com/) account with a JWKS endpoint
- [OpenAI](https://platform.openai.com/) API key (used by Mem0 for LLM + embeddings)
- [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (or any MongoDB instance) for the Preferences API

```bash
# Authenticate and set project
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

---

## Environment Variables Reference

### Mem0 Stack (VM — `docker-compose.yaml`)

| Variable | Description | Required | Default |
|---|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key for Mem0 LLM + embeddings | Yes | — |
| `NEO4J_USERNAME` | Neo4j database username | No | `neo4j` |
| `NEO4J_PASSWORD` | Neo4j database password | Yes | — |
| `MEM0_USER` | Default user ID for OpenMemory UI | No | `default` |

> **Note:** Neo4j auth is disabled (`NEO4J_AUTH=none`) in the compose file for simplicity. In production, enable auth and set credentials.

### Mem0 Connector API (Cloud Run)

| Variable | Description | Required | Default |
|---|---|---|---|
| `QDRANT_HOST` | Internal IP of the VM running Qdrant | Yes | — |
| `NEO4J_URL` | Bolt URL for Neo4j (e.g. `bolt://10.x.x.x:7687`) | Yes | — |
| `NEO4J_USERNAME` | Neo4j username | No | `neo4j` |
| `NEO4J_PASSWORD` | Neo4j password | Yes | — |
| `OPENAI_API_KEY` | OpenAI API key | Yes | — |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint for JWT verification | Yes | — |

### Preferences API (Cloud Run)

| Variable | Description | Required | Default |
|---|---|---|---|
| `MONGODB_URI` | MongoDB connection string (e.g. `mongodb+srv://...`) | Yes | — |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint for JWT verification | Yes | — |

> **Security:** No secrets have hardcoded defaults. All sensitive values (`OPENAI_API_KEY`, `NEO4J_PASSWORD`, `MONGODB_URI`, `CLERK_JWKS_URL`) must be provided at deploy time. Never commit `.env` files — only `.env.example` templates are checked in.

---

## Part 1 — Deploy Mem0 Stack on e2-medium VM

The VM runs Qdrant (vector DB), Neo4j (graph DB), Mem0 API server, and OpenMemory UI via Docker Compose.

### Step 1: Create the VM

```bash
gcloud compute instances create mem0-server \
  --zone=us-east1-b \
  --machine-type=e2-medium \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB \
  --tags=mem0-server
```

### Step 2: Open firewall ports

Qdrant (6333) and Neo4j Bolt (7687) must be reachable from Cloud Run. Use internal IPs or restrict by source range.

```bash
# Allow Qdrant + Neo4j from internal network (Cloud Run VPC connector)
gcloud compute firewall-rules create allow-mem0-internal \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:6333,tcp:6334,tcp:7687,tcp:7474,tcp:8888,tcp:3000 \
  --source-ranges=10.0.0.0/8 \
  --target-tags=mem0-server
```

> **Production:** Restrict `--source-ranges` to your VPC connector subnet. Do NOT use `0.0.0.0/0` for database ports.

### Step 3: SSH into the VM and install Docker

```bash
gcloud compute ssh mem0-server --zone=us-east1-b
```

Inside the VM:

```bash
# Install Docker
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2

# Start Docker
sudo systemctl enable docker
sudo systemctl start docker

# Add current user to docker group (re-login after)
sudo usermod -aG docker $USER
newgrp docker
```

### Step 4: Upload and run Docker Compose

From your local machine, copy the compose file:

```bash
gcloud compute scp backend/mem0-setup-vm/docker-compose.yaml mem0-server:~/docker-compose.yaml \
  --zone=us-east1-b
```

SSH back into the VM:

```bash
gcloud compute ssh mem0-server --zone=us-east1-b
```

Create a `.env` file with your secrets:

```bash
cat > .env << 'EOF'
OPENAI_API_KEY=sk-your-openai-key-here
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-strong-password-here
MEM0_USER=default
EOF
```

Start the stack:

```bash
docker compose up -d
```

### Step 5: Verify the stack

```bash
# Check all containers are running
docker compose ps

# Test Qdrant
curl http://localhost:6333/healthz

# Test Neo4j
curl http://localhost:7474

# Test Mem0 API
curl http://localhost:8888/health

# OpenMemory UI is at http://<VM_EXTERNAL_IP>:3000
```

### Step 6: Note the VM internal IP

You will need this for the Cloud Run services:

```bash
# From your local machine
gcloud compute instances describe mem0-server \
  --zone=us-east1-b \
  --format='get(networkInterfaces[0].networkIP)'
```

Save this IP — it will be used as `QDRANT_HOST` and in `NEO4J_URL` for the Mem0 Connector.

---

## Part 2 — Deploy Mem0 Connector API to Cloud Run

This service is the authenticated gateway between the mobile app and the Mem0 stack on the VM.

### Step 1: Set environment variables

Replace the placeholders with your actual values:

```bash
export PROJECT_ID=$(gcloud config get-value project)
export REGION=us-east1
export VM_INTERNAL_IP=<from step 6 above>
```

### Step 2: Create a VPC connector (required for Cloud Run → VM communication)

Cloud Run services are serverless and cannot reach Compute Engine internal IPs without a VPC connector.

```bash
# Enable the API
gcloud services enable vpcaccess.googleapis.com

# Create the connector
gcloud compute networks vpc-access connectors create mem0-connector \
  --region=$REGION \
  --range=10.8.0.0/28 \
  --network=default
```

### Step 3: Build and push the Docker image

```bash
cd backend/mem0-vm-cloudrun

# Build and push to Artifact Registry (or use --source for source deploy)
gcloud run deploy mem0-connector \
  --source . \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --vpc-connector=mem0-connector \
  --set-env-vars="QDRANT_HOST=${VM_INTERNAL_IP},NEO4J_URL=bolt://${VM_INTERNAL_IP}:7687,NEO4J_USERNAME=neo4j" \
  --update-secrets="NEO4J_PASSWORD=neo4j-password:latest,OPENAI_API_KEY=openai-api-key:latest,CLERK_JWKS_URL=clerk-jwks-url:latest" \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --port=8080
```

> **Using Secret Manager (recommended):** The `--update-secrets` flag references secrets stored in [Google Secret Manager](https://cloud.google.com/secret-manager). Create them first:
>
> ```bash
> echo -n "your-neo4j-password" | gcloud secrets create neo4j-password --data-file=-
> echo -n "sk-your-openai-key" | gcloud secrets create openai-api-key --data-file=-
> echo -n "https://your-clerk-instance.clerk.accounts.dev/.well-known/jwks.json" | gcloud secrets create clerk-jwks-url --data-file=-
> ```
>
> **Alternative (plain env vars):** Replace `--update-secrets` with `--set-env-vars` if you prefer not to use Secret Manager (not recommended for production):
>
> ```bash
> --set-env-vars="NEO4J_PASSWORD=your-password,OPENAI_API_KEY=sk-...,CLERK_JWKS_URL=https://..."
> ```

### Step 4: Note the service URL

After deployment, `gcloud run deploy` prints the service URL. Save it — this is your `EXPO_PUBLIC_MEMORY_API_URL`.

```
Service URL: https://mem0-connector-xxxxxxxx-ue.a.run.app
```

### Step 5: Test the deployment

```bash
curl https://mem0-connector-xxxxxxxx-ue.a.run.app/health
```

Expected response:

```json
{"status": "healthy", "memory": "connected", "timestamp": "..."}
```

---

## Part 3 — Deploy Preferences API to Cloud Run

### Step 1: Set up MongoDB

Create a [MongoDB Atlas](https://www.mongodb.com/atlas) free-tier cluster (or use any MongoDB instance). Get the connection string:

```
mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

### Step 2: Store secrets in Secret Manager

```bash
echo -n "mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority" \
  | gcloud secrets create mongodb-uri --data-file=-

# Reuse clerk-jwks-url from Part 2, or create if not done:
# echo -n "https://your-clerk-instance.clerk.accounts.dev/.well-known/jwks.json" \
#   | gcloud secrets create clerk-jwks-url --data-file=-
```

### Step 3: Deploy to Cloud Run

```bash
cd backend/preference-mongo-cloudrun

gcloud run deploy preferences-api \
  --source . \
  --region=europe-west1 \
  --platform=managed \
  --allow-unauthenticated \
  --update-secrets="MONGODB_URI=mongodb-uri:latest,CLERK_JWKS_URL=clerk-jwks-url:latest" \
  --memory=256Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --port=8080
```

> **Alternative (plain env vars):**
>
> ```bash
> --set-env-vars="MONGODB_URI=mongodb+srv://...,CLERK_JWKS_URL=https://..."
> ```

### Step 4: Note the service URL

Save the printed URL — this is your `EXPO_PUBLIC_PREFERENCES_API_URL`.

```
Service URL: https://preferences-api-xxxxxxxx-ew.a.run.app
```

### Step 5: Test the deployment

```bash
curl https://preferences-api-xxxxxxxx-ew.a.run.app/health
```

Expected response:

```json
{"status": "healthy"}
```

---

## Verify Deployment

After all three components are deployed, verify end-to-end connectivity:

```bash
# 1. VM stack health
gcloud compute ssh mem0-server --zone=us-east1-b --command="docker compose ps"

# 2. Mem0 Connector (Cloud Run → VM)
curl https://mem0-connector-xxxxxxxx-ue.a.run.app/health

# 3. Preferences API (Cloud Run → MongoDB)
curl https://preferences-api-xxxxxxxx-ew.a.run.app/health
```

Then update your app `.env`:

```env
EXPO_PUBLIC_MEMORY_API_URL=https://mem0-connector-xxxxxxxx-ue.a.run.app
EXPO_PUBLIC_PREFERENCES_API_URL=https://preferences-api-xxxxxxxx-ew.a.run.app
```

---

## Troubleshooting

### Cloud Run cannot reach the VM

- Ensure the VPC connector is in the **same region** as the Cloud Run service
- Verify firewall rules allow traffic from the VPC connector subnet (`10.8.0.0/28`) to the VM
- Check that the VM internal IP is correct: `gcloud compute instances describe mem0-server --zone=us-east1-b --format='get(networkInterfaces[0].networkIP)'`

### Mem0 Connector shows `"memory": "disconnected"`

- SSH into the VM and check Qdrant/Neo4j are running: `docker compose ps`
- Verify Qdrant is reachable: `curl http://<VM_INTERNAL_IP>:6333/healthz`
- Check Cloud Run logs: `gcloud run services logs read mem0-connector --region=us-east1`

### Preferences API shows `"status": "unhealthy"`

- Verify `MONGODB_URI` is correct and the IP is whitelisted in MongoDB Atlas (Network Access → Add `0.0.0.0/0` for Cloud Run or use VPC peering)
- Check Cloud Run logs: `gcloud run services logs read preferences-api --region=europe-west1`

### Docker Compose containers keep restarting

- Check container logs: `docker compose logs <service-name>`
- Ensure the VM has enough memory (e2-medium = 4 GB). Monitor with: `free -h`
- If Neo4j OOMs, add memory limits in `docker-compose.yaml`:
  ```yaml
  neo4j:
    deploy:
      resources:
        limits:
          memory: 1G
  ```

### Authentication errors (401)

- Verify `CLERK_JWKS_URL` is correct and reachable: `curl <CLERK_JWKS_URL>`
- Ensure the JWT template in Clerk matches what the app sends
- Check token expiry — Clerk JWTs are short-lived by default

---

## Local Development

### Mem0 Stack (VM services locally)

```bash
cd backend/mem0-setup-vm
cp ../.env.example .env  # or create .env with required vars
docker compose up
```

### Mem0 Connector API

```bash
cd backend/mem0-vm-cloudrun
cp .env.example .env
# Edit .env with local values (QDRANT_HOST=localhost, NEO4J_URL=bolt://localhost:7687, etc.)
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

### Preferences API

```bash
cd backend/preference-mongo-cloudrun
cp .env.example .env
# Edit .env with MONGODB_URI and CLERK_JWKS_URL
pip install -r requirements.txt
uvicorn main:app --reload --port 8081
```

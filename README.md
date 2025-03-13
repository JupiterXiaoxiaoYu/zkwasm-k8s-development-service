# Deployment Service

A backend service for deploying zkwasm applications to Kubernetes using Helm charts.

## Features

- Access Kubernetes clusters using kubeconfig
- Fetch GitHub container images
- Generate Helm charts using environment variables from the frontend
- Deploy applications to Kubernetes with user-specified namespaces
- **Simple deployment from GitHub URL** - Just provide a GitHub repository URL and namespace

## Prerequisites

- Node.js 14+
- Kubernetes cluster
- Helm 3+
- Access to GitHub Container Registry

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```
PORT=3020
# Base64 encoded kubeconfig
KUBECONFIG_BASE64=
# GitHub API token (optional, for higher rate limits)
GITHUB_TOKEN=
# Path to the generate-helm.sh script
GENERATE_HELM_SCRIPT_PATH=../devops/scripts/generate-helm.sh
```

To encode your kubeconfig file as base64:

```bash
cat ~/.kube/config | base64 -w 0 > kubeconfig_base64.txt
```

## Installation

```bash
# Install dependencies
npm install

# Start the server
npm start

# Start the server in development mode
npm run dev
```

## Web Interface

The service provides several web interfaces:

- `/` - Main dashboard
- `/simple-deploy` - Simplified deployment interface (recommended)
- `/test-k8s` - Test Kubernetes connection

## API Endpoints

### Kubernetes Deployments

- `GET /api/deployments?namespace=<namespace>` - List all deployments in the specified namespace
- `GET /api/deployments/:name?namespace=<namespace>` - Get deployment details in the specified namespace
- `DELETE /api/deployments/:name?namespace=<namespace>` - Delete a deployment in the specified namespace

### GitHub

- `GET /api/github/repos/:owner/:repo` - Get repository information
- `GET /api/github/packages/:owner` - List packages (container images)
- `GET /api/github/packages/:owner/:packageName/versions` - Get package versions
- `GET /api/github/images/:owner/:imageName/:tag` - Check if an image exists

### Helm

- `POST /api/helm/deploy-from-github` - Deploy from GitHub URL (simplified)
- `POST /api/helm/deploy` - Generate and deploy a Helm chart (advanced)
- `POST /api/helm/generate` - Generate a Helm chart without deploying
- `DELETE /api/helm/:releaseName?namespace=<namespace>` - Delete a Helm release in the specified namespace
- `GET /api/helm/releases?namespace=<namespace>` - List Helm releases in the specified namespace

## Example Usage

### Deploy from GitHub URL (Simplified)

```bash
curl -X POST http://localhost:3020/api/helm/deploy-from-github \
  -H "Content-Type: application/json" \
  -d '{
    "githubUrl": "https://github.com/username/repository",
    "namespace": "zkwasm-apps",
    "envVars": {
      "chainId": "11155111",
      "allowedOrigins": "*"
    }
  }'
```

### Deploy a Helm Chart (Advanced)

```bash
curl -X POST http://localhost:3020/api/helm/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "chartName": "zkwasm-automata",
    "releaseName": "my-release",
    "namespace": "zkwasm-apps",
    "imageOwner": "myorg",
    "imageTag": "latest",
    "chainId": "11155111",
    "allowedOrigins": "*",
    "deployValue": "TRUE",
    "remoteValue": "TRUE",
    "autoSubmitValue": "",
    "migrateValue": "FALSE",
    "migrateImageValue": "",
    "settlementContractAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "rpcProvider": "https://sepolia.infura.io/v3/your-api-key",
    "envVars": {
      "CUSTOM_ENV_VAR1": "value1",
      "CUSTOM_ENV_VAR2": "value2"
    }
  }'
```

## Available Environment Variables for Helm Chart Generation

The following environment variables can be specified when generating or deploying a Helm chart:

| Variable | Description | Default Value |
|----------|-------------|---------------|
| chartName | Name of the Helm chart | Required (auto-derived from repo name in simplified mode) |
| chainId | Blockchain network ID | 11155111 (Sepolia testnet) |
| allowedOrigins | CORS allowed origins | * |
| deployValue | Whether to deploy | TRUE |
| remoteValue | Whether to use remote mode | TRUE |
| autoSubmitValue | Auto submit setting | "" |
| migrateValue | Whether to migrate | FALSE |
| migrateImageValue | MD5 value of the image to migrate | "" |
| imageTag | MD5 value or tag of the image | "latest" in simplified mode |
| settlementContractAddress | Settlement contract address | "" |
| rpcProvider | RPC provider URL | "" |

You can also pass any additional environment variables using the `envVars.custom` object.

## License

MIT 
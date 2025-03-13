#!/bin/bash

# 设置测试环境变量
export CHART_NAME="test-chart"
export CHART_PATH="./test-chart"
export TEST_VAR1="test-value-1"
export TEST_VAR2="test-value-2"
export CUSTOM_ENV_VAR="custom-value"

# 清理之前的测试目录
rm -rf ${CHART_PATH}
mkdir -p ${CHART_PATH}

echo "=== 测试自定义环境变量处理 ==="
echo "设置的环境变量:"
echo "CHART_NAME=${CHART_NAME}"
echo "CHART_PATH=${CHART_PATH}"
echo "TEST_VAR1=${TEST_VAR1}"
echo "TEST_VAR2=${TEST_VAR2}"
echo "CUSTOM_ENV_VAR=${CUSTOM_ENV_VAR}"

# 创建模拟的values.yaml文件，只包含指定的自定义环境变量
cat > ${CHART_PATH}/values.yaml << EOL
# Default values for ${CHART_NAME}
replicaCount: 1

image:
  repository: ghcr.io/test-user/${CHART_NAME}
  pullPolicy: Always
  tag: "latest"

config:
  app:
    customEnv:
      TEST_VAR1: "${TEST_VAR1}"
      TEST_VAR2: "${TEST_VAR2}"
      CUSTOM_ENV_VAR: "${CUSTOM_ENV_VAR}"
EOL

echo "创建了模拟的values.yaml文件:"
cat ${CHART_PATH}/values.yaml

# 创建Chart.yaml文件，这是Helm必需的
cat > ${CHART_PATH}/Chart.yaml << EOL
apiVersion: v2
name: ${CHART_NAME}
description: A Helm chart for testing custom environment variables
type: application
version: 0.1.0
appVersion: "1.0.0"
EOL

echo "创建了Chart.yaml文件:"
cat ${CHART_PATH}/Chart.yaml

# 创建deployment.yaml模板
mkdir -p ${CHART_PATH}/templates
DEPLOYMENT_TEMPLATE="${CHART_PATH}/templates/deployment.yaml"

cat > ${DEPLOYMENT_TEMPLATE} << 'EOL'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: test-app
  template:
    metadata:
      labels:
        app: test-app
    spec:
      containers:
      - name: app
        image: "nginx:latest"
        env:
        - name: STANDARD_VAR
          value: "standard-value"
        # 添加自定义环境变量
        {{- if .Values.config.app.customEnv }}
        # 以下是用户指定的自定义环境变量
        {{- range $key, $value := .Values.config.app.customEnv }}
        - name: {{ $key }}
          value: "{{ $value }}"
        {{- end }}
        {{- end }}
EOL

echo "创建了deployment.yaml模板:"
cat ${DEPLOYMENT_TEMPLATE}

# 使用helm template命令测试模板渲染
echo "=== 测试Helm模板渲染 ==="
if command -v helm &> /dev/null; then
  helm template ${CHART_PATH}
else
  echo "Helm命令不可用，无法测试模板渲染"
fi

echo "=== 测试完成 ===" 
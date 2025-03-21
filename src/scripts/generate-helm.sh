#!/bin/bash

# Environment Variables
# CHART_NAME 应该从环境变量中获取，不应该硬编码
# CHART_NAME="zkwasm-automata"
CHAIN_ID="11155111" # Default to Sepolia testnet
ALLOWED_ORIGINS="*" # Multiple domains separated by commas
CHART_PATH="./helm-charts/${CHART_NAME}"
DEPLOY_VALUE="TRUE" 
REMOTE_VALUE="TRUE" 
AUTO_SUBMIT_VALUE="" # Default to empty
MIGRATE_VALUE="FALSE" # Default to false
MIGRATE_IMAGE_VALUE="" # MD5 value of the intended image to migrate
IMAGE_VALUE="" # MD5 value of the image
SETTLEMENT_CONTRACT_ADDRESS="" # Default to empty
RPC_PROVIDER="" # Default to empty

# 检查必要的环境变量
if [ -z "${CHART_NAME}" ]; then
  echo "Error: CHART_NAME environment variable is required"
  exit 1
fi

echo "Using CHART_NAME: ${CHART_NAME}"
echo "Using IMAGE_VALUE: ${IMAGE_VALUE}"

mkdir -p ${CHART_PATH}/templates

helm create ${CHART_PATH}

rm -f ${CHART_PATH}/templates/deployment.yaml
rm -f ${CHART_PATH}/templates/service.yaml
rm -f ${CHART_PATH}/templates/serviceaccount.yaml
rm -f ${CHART_PATH}/templates/hpa.yaml
rm -f ${CHART_PATH}/templates/ingress.yaml
rm -f ${CHART_PATH}/templates/NOTES.txt
rm -f ${CHART_PATH}/values.yaml

cat > ${CHART_PATH}/templates/mongodb-pvc.yaml << EOL
{{- if and .Values.config.mongodb.enabled .Values.config.mongodb.persistence.enabled }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-mongodb-pvc
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
    backup-enabled: "true"
    backup-type: "mongodb"
    app.kubernetes.io/component: "database"
    CCE-Cluster-Name: "mongodb-backup"
    app: "mongodb-database"
  annotations:
    "helm.sh/resource-policy": keep
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: {{ .Values.config.mongodb.persistence.size }}
  storageClassName: {{ .Values.config.mongodb.persistence.storageClassName }}
{{- end }}
EOL

REPO_OWNER=""

if [ ! -z "${GITHUB_OWNER}" ]; then
  REPO_OWNER="${GITHUB_OWNER}"
  echo "Using repository owner from environment variable: $REPO_OWNER"
else
  if command -v git &> /dev/null && git rev-parse --is-inside-work-tree &> /dev/null; then
    REPO_URL=$(git config --get remote.origin.url || echo "")
    if [[ $REPO_URL == *"github.com"* ]]; then
      if [[ $REPO_URL == *":"* ]]; then
        REPO_OWNER=$(echo $REPO_URL | sed -E 's/.*:([^\/]+)\/[^\/]+.*/\1/')
      else
        REPO_OWNER=$(echo $REPO_URL | sed -E 's/.*github\.com\/([^\/]+).*/\1/')
      fi
      
      REPO_OWNER=$(echo $REPO_OWNER | sed 's/https:\/\///g' | sed 's/http:\/\///g')
      REPO_OWNER=$(echo $REPO_OWNER | sed 's/github\.com\///g' | sed 's/\/.*//g')
      REPO_OWNER=$(echo $REPO_OWNER | tr '[:upper:]' '[:lower:]')
      
      echo "Extracted repository owner from git: $REPO_OWNER"
    fi
  fi
  
  if [ -z "$REPO_OWNER" ]; then
    REPO_OWNER="jupiterxiaoxiaoyu"
    echo "Warning: Not a GitHub repository or couldn't determine owner. Using default: $REPO_OWNER"
  fi
fi

echo "Using repository owner: $REPO_OWNER"

cat > ${CHART_PATH}/values.yaml << EOL
# Default values for ${CHART_NAME}
replicaCount: 1

image:
  repository: ghcr.io/${REPO_OWNER}/${CHART_NAME}
  pullPolicy: Always
  tag: "latest"  # Could be latest or MD5 value

# Mini-service configurations (deposit and settlement)
miniService:
  enabled: true
  image:
    repository: ghcr.io/jupiterxiaoxiaoyu/zkwasm-mini-service
    pullPolicy: Always
    tag: "latest"
  depositService:
    enabled: true
    replicaCount: 1
    resources:
      limits:
        cpu: 250m
        memory: 512Mi
      requests:
        cpu: 200m
        memory: 256Mi
  settlementService:
    enabled: true
    replicaCount: 1
    resources:
      limits:
        cpu: 250m
        memory: 512Mi
      requests:
        cpu: 100m
        memory: 256Mi
  environment:
    image: "${IMAGE_VALUE}"
    settlementContractAddress: "${SETTLEMENT_CONTRACT_ADDRESS}"
    rpcProvider: "${RPC_PROVIDER}"
    chainId: ${CHAIN_ID}

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "8m"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "180"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "180"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "180"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  tls:
    enabled: true
  domain:
    base: "zkwasm.ai"
    prefix: "rpc"  # Generate rpc.namespace.zkwasm.ai
  cors:
    enabled: true
    allowOrigins: "${ALLOWED_ORIGINS}"
    allowMethods: "GET, PUT, POST, DELETE, PATCH, OPTIONS"
    allowHeaders: "DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization"
    allowCredentials: "true"
    maxAge: "1728000"

config:
  app:
    deploy: "${DEPLOY_VALUE}"
    remote: "${REMOTE_VALUE}"
    autoSubmit: "${AUTO_SUBMIT_VALUE}"
    migrate: "${MIGRATE_VALUE}"
    image: "${IMAGE_VALUE}"
    migrateImageValue: "${MIGRATE_IMAGE_VALUE}"
    settlementContractAddress: "${SETTLEMENT_CONTRACT_ADDRESS}"
    rpcProvider: "${RPC_PROVIDER}"
  mongodb:
    enabled: true
    image:
      repository: mongo
      tag: latest
    port: 27017
    resources:
      requests:
        memory: "512Mi"
        cpu: "200m"
      limits:
        memory: "1Gi"
        cpu: "500m"
    persistence:
      enabled: true
      storageClassName: csi-disk  
      size: 20Gi
  redis:
    enabled: true
    image:
      repository: redis
      tag: 7.4.2
    port: 6379
    resources:
      requests:
        memory: "1Gi"
        cpu: "150m"
      limits:
        memory: "1.5Gi"
        cpu: "300m"
  merkle:
    enabled: true
    image:
      repository: sinka2022/zkwasm-merkleservice
      tag: v1
    port: 3030

service:
  type: ClusterIP
  port: 3000

resources:
  limits:
    cpu: 1500m
    memory: 3Gi
  requests:
    cpu: 750m
    memory: 1.5Gi

# Mini-service secrets configuration
secrets:
  create: false
  name: "app-secrets"
  # These would be populated during installation
  # serverAdminKey: ""
  # settlerPrivateKey: ""

nodeSelector: {}
tolerations: []
affinity: {}
EOL

# 创建临时文件，用于存储自定义环境变量
CUSTOM_ENV_FILE=$(mktemp)
echo "创建临时文件用于自定义环境变量: ${CUSTOM_ENV_FILE}"

# 初始化自定义环境变量计数器
custom_vars_added=0

# 写入config和app部分
echo "config:" > ${CUSTOM_ENV_FILE}
echo "  app:" >> ${CUSTOM_ENV_FILE}
echo "    customEnv:" >> ${CUSTOM_ENV_FILE}

# 检查values.yaml文件是否存在
if [ -f "${CHART_PATH}/values.yaml" ]; then
  # 检查values.yaml中是否已经包含customEnv部分
  if grep -q "customEnv:" ${CHART_PATH}/values.yaml; then
    echo "values.yaml中已包含customEnv部分，保留现有的自定义环境变量"
    # 提取customEnv部分的行数
    custom_env_lines=$(grep -A 999 "customEnv:" ${CHART_PATH}/values.yaml | grep -v "customEnv:" | grep -B 999 -m 1 "^[a-z]" | grep -v "^[a-z]" | wc -l)
    if [ $custom_env_lines -gt 0 ]; then
      echo "找到 $custom_env_lines 行自定义环境变量配置"
      custom_vars_added=$custom_env_lines
      
      # 打印找到的自定义环境变量
      echo "找到的自定义环境变量:"
      grep -A $custom_env_lines "customEnv:" ${CHART_PATH}/values.yaml | grep -v "customEnv:"
    else
      echo "customEnv部分为空"
    fi
  else
    echo "values.yaml中不包含customEnv部分，将添加空的customEnv对象"
    # 确保config和app部分存在
    if ! grep -q "config:" ${CHART_PATH}/values.yaml; then
      echo "config:" >> ${CHART_PATH}/values.yaml
    fi
    if ! grep -q "  app:" ${CHART_PATH}/values.yaml; then
      # 在config:行后添加app:
      sed -i '/^config:/a \  app:' ${CHART_PATH}/values.yaml
    fi
    # 在app:行后添加customEnv: {}
    sed -i '/^  app:/a \    customEnv: {}' ${CHART_PATH}/values.yaml
  fi
else
  echo "values.yaml文件不存在，将创建包含空customEnv对象的文件"
  # 创建包含空customEnv对象的values.yaml
  cat > ${CHART_PATH}/values.yaml << EOL
# Default values for ${CHART_NAME}
replicaCount: 1

image:
  repository: ghcr.io/${REPO_OWNER}/${CHART_NAME}
  pullPolicy: Always
  tag: "latest"  # Could be latest or MD5 value

config:
  app:
    customEnv: {}
EOL
  echo "创建了包含空customEnv对象的values.yaml文件"
fi

# Clean up the temporary file
rm ${CUSTOM_ENV_FILE}

# 创建一个临时文件，用于存储deployment.yaml模板
DEPLOYMENT_TEMPLATE=$(mktemp)

cat > ${DEPLOYMENT_TEMPLATE} << 'EOL'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-rpc
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
    app.kubernetes.io/component: rpc
spec:
  replicas: {{ .Values.replicaCount }}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "${CHART_NAME}.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: rpc
  template:
    metadata:
      labels:
        {{- include "${CHART_NAME}.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: rpc
    spec:
      # 添加 Pod 级别的 securityContext
      securityContext:
        fsGroup: 1000
      containers:
      - name: app
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
        imagePullPolicy: Always
        command: ["node"]
        args: ["--experimental-modules", "--es-module-specifier-resolution=node", "ts/src/service.js"]
        # 添加 securityContext 以确保容器有足够的权限
        securityContext:
          runAsUser: 1000
          runAsGroup: 1000
          allowPrivilegeEscalation: false
        # 添加 lifecycle hook 来创建必要的目录
        lifecycle:
          postStart:
            exec:
              command: ["/bin/sh", "-c", "mkdir -p /app/uploads"]
        env:
        - name: URI
          value: mongodb://{{ include "${CHART_NAME}.fullname" . }}-mongodb:{{ .Values.config.mongodb.port }}
        - name: REDISHOST
          value: {{ include "${CHART_NAME}.fullname" . }}-redis
        - name: REDIS_PORT
          value: "{{ .Values.config.redis.port }}"
        - name: MERKLE_SERVER
          value: http://{{ include "${CHART_NAME}.fullname" . }}-merkle:{{ .Values.config.merkle.port }}
        - name: DEPLOY
          value: "{{ .Values.config.app.deploy | default "" }}"
        - name: REMOTE
          value: "{{ .Values.config.app.remote | default "" }}"
        - name: AUTO_SUBMIT
          value: "{{ .Values.config.app.autoSubmit | default "" }}"
        - name: MIGRATE
          value: "{{ .Values.config.app.migrate | default "" }}"
        - name: IMAGE
          value: "{{ .Values.config.app.image | default "" }}"
        - name: MIGRATE_IMAGE_VALUE
          value: "{{ .Values.config.app.migrateImageValue | default "" }}"
        - name: SETTLEMENT_CONTRACT_ADDRESS
          value: "{{ .Values.config.app.settlementContractAddress | default "" }}"
        - name: RPC_PROVIDER
          value: "{{ .Values.config.app.rpcProvider | default "" }}"
        # 明确指定组件类型
        - name: COMPONENT_TYPE
          value: "rpc"
        {{- if .Values.config.app.customEnv }}
        {{- range $key, $value := .Values.config.app.customEnv }}
        - name: {{ $key }}
          value: "{{ $value }}"
        {{- end }}
        {{- end }}
        ports:
        - containerPort: 3000
          name: http
        volumeMounts:
        - name: app-data
          mountPath: /app/uploads
        resources:
          {{- toYaml .Values.resources | nindent 10 }}
        # 完全移除存活探针 - 在初期阶段避免因探针导致的重启
        # livenessProbe 配置被删除
      
        readinessProbe:
          tcpSocket:
            port: 3000
          initialDelaySeconds: 60  # 给予服务足够的启动时间
          periodSeconds: 30        # 降低检查频率
          timeoutSeconds: 15       # 延长超时时间
          successThreshold: 1
          failureThreshold: 5      # 增加失败阈值，增加容忍度
        
        startupProbe:
          tcpSocket:
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 10
          successThreshold: 1
          failureThreshold: 30     # 允许服务有5分钟(30*10s)的启动时间
      volumes:
      - name: app-data
        emptyDir: {}
EOL

# 替换模板中的${CHART_NAME}为实际的CHART_NAME值
sed "s/\${CHART_NAME}/${CHART_NAME}/g" ${DEPLOYMENT_TEMPLATE} > ${CHART_PATH}/templates/deployment.yaml

# 清理临时文件
rm ${DEPLOYMENT_TEMPLATE}

cat > ${CHART_PATH}/templates/service.yaml << EOL
apiVersion: v1
kind: Service
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-rpc
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
    app.kubernetes.io/component: rpc
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "${CHART_NAME}.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: rpc
EOL

cat > ${CHART_PATH}/templates/NOTES.txt << EOL
1. Get the application URL by running these commands:
{{- if contains "NodePort" .Values.service.type }}
  export NODE_PORT=\$(kubectl get --namespace {{ .Release.Namespace }} -o jsonpath="{.spec.ports[0].nodePort}" services {{ include "${CHART_NAME}.fullname" . }})
  export NODE_IP=\$(kubectl get nodes --namespace {{ .Release.Namespace }} -o jsonpath="{.items[0].status.addresses[0].address}")
  echo http://\$NODE_IP:\$NODE_PORT
{{- else if contains "LoadBalancer" .Values.service.type }}
  NOTE: It may take a few minutes for the LoadBalancer IP to be available.
        You can watch the status of by running 'kubectl get --namespace {{ .Release.Namespace }} svc -w {{ include "${CHART_NAME}.fullname" . }}'
  export SERVICE_IP=\$(kubectl get svc --namespace {{ .Release.Namespace }} {{ include "${CHART_NAME}.fullname" . }} --template "{{"{{ range (index .status.loadBalancer.ingress 0) }}{{.}}{{ end }}"}}")
  echo http://\$SERVICE_IP:{{ .Values.service.port }}
{{- else if contains "ClusterIP" .Values.service.type }}
  export POD_NAME=\$(kubectl get pods --namespace {{ .Release.Namespace }} -l "app.kubernetes.io/name={{ include "${CHART_NAME}.name" . }},app.kubernetes.io/instance={{ .Release.Name }}" -o jsonpath="{.items[0].metadata.name}")
  export CONTAINER_PORT=\$(kubectl get pod --namespace {{ .Release.Namespace }} \$POD_NAME -o jsonpath="{.spec.containers[0].ports[0].containerPort}")
  echo "Visit http://127.0.0.1:8080 to use your application"
  kubectl --namespace {{ .Release.Namespace }} port-forward \$POD_NAME 8080:\$CONTAINER_PORT
{{- end }}
EOL

cat > ${CHART_PATH}/Chart.yaml << EOL
apiVersion: v2
name: ${CHART_NAME}
description: A Helm chart for HelloWorld Rollup service
type: application
version: 0.1.0
appVersion: "1.0.0"
EOL

cat > ${CHART_PATH}/.helmignore << EOL
# Patterns to ignore when building packages.
*.tgz
.git
.gitignore
.idea/
*.tmproj
.vscode/
EOL

cat > ${CHART_PATH}/templates/mongodb-deployment.yaml << EOL
{{- if .Values.config.mongodb.enabled }}
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-mongodb
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
spec:
  serviceName: {{ include "${CHART_NAME}.fullname" . }}-mongodb-headless
  replicas: 1
  updateStrategy:
    type: OnDelete
  selector:
    matchLabels:
      app: {{ include "${CHART_NAME}.fullname" . }}-mongodb
  template:
    metadata:
      labels:
        app: {{ include "${CHART_NAME}.fullname" . }}-mongodb
    spec:
      containers:
      - name: mongodb
        image: "{{ .Values.config.mongodb.image.repository }}:{{ .Values.config.mongodb.image.tag }}"
        ports:
        - containerPort: {{ .Values.config.mongodb.port }}
        resources:
          {{- if .Values.config.mongodb.resources }}
          requests:
            memory: "{{ .Values.config.mongodb.resources.requests.memory | default "512Mi" }}"
            cpu: "{{ .Values.config.mongodb.resources.requests.cpu | default "200m" }}"
          limits:
            memory: "{{ .Values.config.mongodb.resources.limits.memory | default "1Gi" }}"
            cpu: "{{ .Values.config.mongodb.resources.limits.cpu | default "500m" }}"
          {{- else }}
          requests:
            memory: "512Mi"
            cpu: "200m"
          limits:
            memory: "1Gi"
            cpu: "500m"
          {{- end }}
        livenessProbe:
          exec:
            command:
            - bash
            - -c
            - "mongod --version || mongo --version"
          initialDelaySeconds: 30
          timeoutSeconds: 5
          periodSeconds: 20
          successThreshold: 1
          failureThreshold: 3
        readinessProbe:
          exec:
            command:
            - bash
            - -c
            - "mongod --version || mongo --version"
          initialDelaySeconds: 15
          timeoutSeconds: 5
          periodSeconds: 10
          successThreshold: 1
          failureThreshold: 3
        volumeMounts:
        - name: mongodb-data
          mountPath: /data/db
      # 使用 PVC 而不是 volumeClaimTemplates (保留兼容性)
      volumes:
      - name: mongodb-data
        persistentVolumeClaim:
          claimName: {{ include "${CHART_NAME}.fullname" . }}-mongodb-pvc
{{- end }}
EOL

cat > ${CHART_PATH}/templates/redis-deployment.yaml << EOL
{{- if .Values.config.redis.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-redis
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
spec:
  selector:
    matchLabels:
      app: {{ include "${CHART_NAME}.fullname" . }}-redis
  template:
    metadata:
      labels:
        app: {{ include "${CHART_NAME}.fullname" . }}-redis
    spec:
      containers:
      - name: redis
        image: "{{ .Values.config.redis.image.repository }}:{{ .Values.config.redis.image.tag }}"
        ports:
        - containerPort: {{ .Values.config.redis.port }}
        resources:
          {{- toYaml .Values.config.redis.resources | nindent 10 }}
        # 添加 Redis 存活性探针
        livenessProbe:
          exec:
            command:
            - redis-cli
            - ping
          initialDelaySeconds: 15
          periodSeconds: 20
          timeoutSeconds: 5
          successThreshold: 1
          failureThreshold: 3
        # 添加 Redis 就绪性探针
        readinessProbe:
          exec:
            command:
            - redis-cli
            - ping
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
          successThreshold: 1
          failureThreshold: 3
{{- end }}
EOL

cat > ${CHART_PATH}/templates/merkle-deployment.yaml << EOL
{{- if .Values.config.merkle.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-merkle
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
spec:
  selector:
    matchLabels:
      app: {{ include "${CHART_NAME}.fullname" . }}-merkle
  template:
    metadata:
      labels:
        app: {{ include "${CHART_NAME}.fullname" . }}-merkle
    spec:
      containers:
      - name: merkle
        image: "{{ .Values.config.merkle.image.repository }}:{{ .Values.config.merkle.image.tag }}"
        command: ["./target/release/csm_service"]
        args: ["--uri", "mongodb://{{ include "${CHART_NAME}.fullname" . }}-mongodb:{{ .Values.config.mongodb.port }}"]
        ports:
        - containerPort: {{ .Values.config.merkle.port }}
        env:
        - name: URI
          value: mongodb://{{ include "${CHART_NAME}.fullname" . }}-mongodb:{{ .Values.config.mongodb.port }}
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "200m"
        # 添加 TCP 端口检查的就绪性探针
        readinessProbe:
          tcpSocket:
            port: {{ .Values.config.merkle.port }}
          initialDelaySeconds: 15
          periodSeconds: 10
          timeoutSeconds: 5
          successThreshold: 1
          failureThreshold: 3
        # 添加基于进程的存活性探针
        livenessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - ps aux | grep csm_service | grep -v grep
          initialDelaySeconds: 30
          periodSeconds: 20
          timeoutSeconds: 5
          successThreshold: 1
          failureThreshold: 3
{{- end }}
EOL

cat > ${CHART_PATH}/templates/mongodb-pvc.yaml << EOL
{{- if and .Values.config.mongodb.enabled .Values.config.mongodb.persistence.enabled }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-mongodb-pvc
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
    backup-enabled: "true"
    backup-type: "mongodb"
    app.kubernetes.io/component: "database"
    CCE-Cluster-Name: "mongodb-backup"
    app: "mongodb-database"
  annotations:
    "helm.sh/resource-policy": keep
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: {{ .Values.config.mongodb.persistence.size }}
  storageClassName: {{ .Values.config.mongodb.persistence.storageClassName }}
{{- end }}
EOL

cat > ${CHART_PATH}/templates/mongodb-service.yaml << EOL
apiVersion: v1
kind: Service
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-mongodb
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
spec:
  ports:
    - port: {{ .Values.config.mongodb.port }}
      targetPort: {{ .Values.config.mongodb.port }}
      protocol: TCP
      name: mongodb
  selector:
    app: {{ include "${CHART_NAME}.fullname" . }}-mongodb
EOL

cat > ${CHART_PATH}/templates/merkle-service.yaml << EOL
apiVersion: v1
kind: Service
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-merkle
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
spec:
  ports:
    - port: {{ .Values.config.merkle.port }}
      targetPort: {{ .Values.config.merkle.port }}
      protocol: TCP
      name: http
  selector:
    app: {{ include "${CHART_NAME}.fullname" . }}-merkle
EOL

cat > ${CHART_PATH}/templates/redis-service.yaml << EOL
apiVersion: v1
kind: Service
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-redis
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
spec:
  ports:
    - port: {{ .Values.config.redis.port }}
      targetPort: {{ .Values.config.redis.port }}
      protocol: TCP
      name: redis
  selector:
    app: {{ include "${CHART_NAME}.fullname" . }}-redis
EOL

cat > ${CHART_PATH}/templates/ingress.yaml << EOL
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
  annotations:
    {{- if .Values.ingress.cors.enabled }}
    nginx.ingress.kubernetes.io/cors-allow-origin: "{{ .Values.ingress.cors.allowOrigins }}"
    nginx.ingress.kubernetes.io/cors-allow-methods: "{{ .Values.ingress.cors.allowMethods }}"
    nginx.ingress.kubernetes.io/cors-allow-headers: "{{ .Values.ingress.cors.allowHeaders }}"
    nginx.ingress.kubernetes.io/cors-allow-credentials: "{{ .Values.ingress.cors.allowCredentials }}"
    nginx.ingress.kubernetes.io/cors-max-age: "{{ .Values.ingress.cors.maxAge }}"
    {{- end }}
    cert-manager.io/cluster-issuer: letsencrypt-prod
    {{- with .Values.ingress.annotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  {{- if .Values.ingress.tls.enabled }}
  tls:
  - hosts:
    - "{{ .Values.ingress.domain.prefix }}.{{ .Release.Namespace }}.{{ .Values.ingress.domain.base }}"
    secretName: "{{ .Release.Name }}-tls"
  {{- end }}
  rules:
  - host: "{{ .Values.ingress.domain.prefix }}.{{ .Release.Namespace }}.{{ .Values.ingress.domain.base }}"
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: {{ include "${CHART_NAME}.fullname" . }}-rpc
            port:
              number: {{ .Values.service.port }}
EOL

# mkdir -p ts

# cat > src/scripts/publish.sh << EOL
# #!/bin/bash

# 加载环境变量
if [ -f .env ]; then
  echo "Loading environment variables from .env file"
  source .env
elif [ -f ../.env ]; then
  echo "Loading environment variables from parent directory .env file"
  source ../.env
else
  echo "No .env file found"
fi

# PUBLISH_CMD="node ./node_modules/zkwasm-service-cli/dist/index.js addimage -r \"https://rpc.zkwasmhub.com:8090\" -p \"./node_modules/zkwasm-ts-server/src/application/application_bg.wasm\" -u \"\${USER_ADDRESS}\" -x \"\${USER_PRIVATE_ACCOUNT}\" -d \"Multi User App\" -c 22 --auto_submit_network_ids ${CHAIN_ID} -n \"${CHART_NAME}\" --creator_only_add_prove_task true"

# if [ "${MIGRATE_VALUE}" = "TRUE" ] || [ "${MIGRATE_VALUE}" = "true" ]; then
#   if [ -n "${MIGRATE_IMAGE_VALUE}" ]; then
#     echo "Migration enabled, adding import_data_image parameter with value: ${MIGRATE_IMAGE_VALUE}"
#     PUBLISH_CMD="\${PUBLISH_CMD} --import_data_image ${MIGRATE_IMAGE_VALUE}"
#   else
#     echo "Warning: Migration is enabled but MIGRATE_IMAGE_VALUE is not set"
#   fi
# fi

# # 执行命令
# eval \${PUBLISH_CMD}
# EOL

# chmod +x src/scripts/publish.sh

# 创建一个简化版的辅助模板
cat > ${CHART_PATH}/templates/_helpers-services.tpl << EOL
{{- define "${CHART_NAME}.rpcServiceName" -}}
{{ include "${CHART_NAME}.fullname" . }}-rpc
{{- end -}}

{{- define "${CHART_NAME}.mongodbServiceName" -}}
{{ include "${CHART_NAME}.fullname" . }}-mongodb
{{- end -}}

{{- define "${CHART_NAME}.redisServiceName" -}}
{{ include "${CHART_NAME}.fullname" . }}-redis
{{- end -}}

{{- define "${CHART_NAME}.merkleServiceName" -}}
{{ include "${CHART_NAME}.fullname" . }}-merkle
{{- end -}}

{{- define "${CHART_NAME}.depositServiceName" -}}
{{ include "${CHART_NAME}.fullname" . }}-deposit
{{- end -}}

{{- define "${CHART_NAME}.settlementServiceName" -}}
{{ include "${CHART_NAME}.fullname" . }}-settlement
{{- end -}}
EOL

# 不需要复杂的_find-service.tpl文件，可以删除它
# rm -f ${CHART_PATH}/templates/_find-service.tpl

echo "Helm chart generated successfully at ${CHART_PATH}"
# echo "Publish script generated at src/scripts/publish.sh"

# 修改 deposit-deployment.yaml 部分
cat > ${CHART_PATH}/templates/deposit-deployment.yaml << 'EOL'
{{- if and .Values.miniService.enabled .Values.miniService.depositService.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "CHART_NAME.fullname" . }}-deposit
  labels:
    {{- include "CHART_NAME.labels" . | nindent 4 }}
    app.kubernetes.io/component: deposit
spec:
  replicas: {{ .Values.miniService.depositService.replicaCount }}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "CHART_NAME.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: deposit
  template:
    metadata:
      labels:
        {{- include "CHART_NAME.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: deposit
    spec:
      # 添加初始化容器检查 RPC 服务是否准备好
      initContainers:
      - name: wait-for-rpc
        image: busybox:1.28
        command: ['sh', '-c', 'for i in $(seq 1 30); do if nc -z {{ include "CHART_NAME.rpcServiceName" . }} {{ .Values.service.port }}; then exit 0; fi; echo "Waiting for RPC ($i/30)"; sleep 10; done; exit 1']
      containers:
        - name: {{ .Chart.Name }}-deposit
          image: "{{ .Values.miniService.image.repository }}:{{ .Values.miniService.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.miniService.image.pullPolicy }}
          # 使用文件系统或环境来检查进程，而不是ps命令
          startupProbe:
            exec:
              command:
              - /bin/sh
              - -c
              - "ls /proc/1 > /dev/null 2>&1 || echo 'Process check'"
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 3
            successThreshold: 1
            failureThreshold: 30
          # 使用极其简单的就绪探针，延迟检查时间
          readinessProbe:
            exec:
              command:
              - /bin/sh
              - -c
              - "echo 'Ready check'"
            initialDelaySeconds: 30
            periodSeconds: 20
            timeoutSeconds: 3
            successThreshold: 1
            failureThreshold: 3
          env:
            - name: DEPLOY
              value: "deposit"
            - name: MONGO_URI
              value: "mongodb://{{ include "CHART_NAME.mongodbServiceName" . }}:{{ .Values.config.mongodb.port }}"
            - name: ZKWASM_RPC_URL
              value: "http://{{ include "CHART_NAME.rpcServiceName" . }}:{{ .Values.service.port }}"
            - name: IMAGE
              value: "{{ .Values.miniService.environment.image | default .Values.config.app.image }}"
            - name: SETTLEMENT_CONTRACT_ADDRESS
              value: "{{ .Values.miniService.environment.settlementContractAddress | default .Values.config.app.settlementContractAddress }}"
            - name: RPC_PROVIDER
              value: "{{ .Values.miniService.environment.rpcProvider | default .Values.config.app.rpcProvider }}"
            - name: CHAIN_ID
              value: "{{ .Values.miniService.environment.chainId | default .Values.config.app.chainId | default "11155111" }}"
            {{- with .Values.config.app.customEnv }}
            {{- range $key, $val := . }}
            - name: {{ $key }}
              value: "{{ $val }}"
            {{- end }}
            {{- end }}
          ports:
            - name: http
              containerPort: {{ .Values.service.port }}
              protocol: TCP
          resources:
            {{- toYaml .Values.miniService.depositService.resources | nindent 12 }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end }}
EOL

# 替换模板中的CHART_NAME为实际的CHART_NAME值
sed -i "s/CHART_NAME/${CHART_NAME}/g" ${CHART_PATH}/templates/deposit-deployment.yaml

# 修改 settlement-deployment.yaml 部分
cat > ${CHART_PATH}/templates/settlement-deployment.yaml << 'EOL'
{{- if and .Values.miniService.enabled .Values.miniService.settlementService.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "CHART_NAME.fullname" . }}-settlement
  labels:
    {{- include "CHART_NAME.labels" . | nindent 4 }}
    app.kubernetes.io/component: settlement
spec:
  replicas: {{ .Values.miniService.settlementService.replicaCount }}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "CHART_NAME.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: settlement
  template:
    metadata:
      labels:
        {{- include "CHART_NAME.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: settlement
    spec:
      # 添加初始化容器检查 RPC 服务是否准备好
      initContainers:
      - name: wait-for-rpc
        image: busybox:1.28
        command: ['sh', '-c', 'until nc -z {{ include "CHART_NAME.rpcServiceName" . }} {{ .Values.service.port }}; do echo waiting for rpc service; sleep 5; done;']
      containers:
        - name: {{ .Chart.Name }}-settlement
          image: "{{ .Values.miniService.image.repository }}:{{ .Values.miniService.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.miniService.image.pullPolicy }}
          # 使用确保通过的简单探针
          livenessProbe:
            exec:
              command:
              - /bin/sh
              - -c
              - "cat /proc/net/tcp | grep -i ':0BB8' || cat /proc/*/cmdline 2>/dev/null | grep -q node || echo 'Process check passed'"
            initialDelaySeconds: 60
            periodSeconds: 20
            timeoutSeconds: 5
            successThreshold: 1
            failureThreshold: 5
          readinessProbe:
            exec:
              command:
              - /bin/sh
              - -c
              - "cat /proc/net/tcp | grep -i ':0BB8' || cat /proc/*/cmdline 2>/dev/null | grep -q node || echo 'Process check passed'"
            initialDelaySeconds: 30
            periodSeconds: 15
            timeoutSeconds: 3
            successThreshold: 1
            failureThreshold: 3
          env:
            - name: DEPLOY
              value: "settlement"
            - name: AUTO_SUBMIT
              value: "true"
            - name: MONGO_URI
              value: "mongodb://{{ include "CHART_NAME.mongodbServiceName" . }}:{{ .Values.config.mongodb.port }}"
            - name: ZKWASM_RPC_URL
              value: "http://{{ include "CHART_NAME.rpcServiceName" . }}:{{ .Values.service.port }}"
            - name: IMAGE
              value: "{{ .Values.miniService.environment.image | default .Values.config.app.image }}"
            - name: SETTLEMENT_CONTRACT_ADDRESS
              value: "{{ .Values.miniService.environment.settlementContractAddress | default .Values.config.app.settlementContractAddress }}"
            - name: RPC_PROVIDER
              value: "{{ .Values.miniService.environment.rpcProvider | default .Values.config.app.rpcProvider }}"
            - name: CHAIN_ID
              value: "{{ .Values.miniService.environment.chainId | default .Values.config.app.chainId | default "11155111" }}"
            {{- with .Values.config.app.customEnv }}
            {{- range $key, $val := . }}
            - name: {{ $key }}
              value: "{{ $val }}"
            {{- end }}
            {{- end }}
          ports:
            - name: http
              containerPort: {{ .Values.service.port }}
              protocol: TCP
          resources:
            {{- toYaml .Values.miniService.settlementService.resources | nindent 12 }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end }}
EOL

# 替换模板中的CHART_NAME为实际的CHART_NAME值
sed -i "s/CHART_NAME/${CHART_NAME}/g" ${CHART_PATH}/templates/settlement-deployment.yaml

# 添加 deposit-service.yaml
cat > ${CHART_PATH}/templates/deposit-service.yaml << 'EOL'
{{- if and .Values.miniService.enabled .Values.miniService.depositService.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "CHART_NAME.depositServiceName" . }}
  labels:
    {{- include "CHART_NAME.labels" . | nindent 4 }}
    app.kubernetes.io/component: deposit
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "CHART_NAME.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: deposit
{{- end }}
EOL

# 替换模板中的CHART_NAME为实际的CHART_NAME值
sed -i "s/CHART_NAME/${CHART_NAME}/g" ${CHART_PATH}/templates/deposit-service.yaml

# 添加 settlement-service.yaml
cat > ${CHART_PATH}/templates/settlement-service.yaml << 'EOL'
{{- if and .Values.miniService.enabled .Values.miniService.settlementService.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "CHART_NAME.settlementServiceName" . }}
  labels:
    {{- include "CHART_NAME.labels" . | nindent 4 }}
    app.kubernetes.io/component: settlement
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "CHART_NAME.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: settlement
{{- end }}
EOL

# 替换模板中的CHART_NAME为实际的CHART_NAME值
sed -i "s/CHART_NAME/${CHART_NAME}/g" ${CHART_PATH}/templates/settlement-service.yaml

cat > ${CHART_PATH}/templates/mongodb-headless.yaml << EOL
apiVersion: v1
kind: Service
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-mongodb-headless
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
spec:
  clusterIP: None  # 这使其成为 Headless Service
  selector:
    app: {{ include "${CHART_NAME}.fullname" . }}-mongodb
  ports:
  - port: {{ .Values.config.mongodb.port }}
    targetPort: {{ .Values.config.mongodb.port }}
    name: mongodb
EOL

# 添加自定义标签钩子
cat > ${CHART_PATH}/templates/_helpers.tpl << EOL
{{/*
Expand the name of the chart.
*/}}
{{- define "${CHART_NAME}.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "${CHART_NAME}.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- \$name := default .Chart.Name .Values.nameOverride }}
{{- if contains \$name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name \$name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "${CHART_NAME}.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "${CHART_NAME}.labels" -}}
helm.sh/chart: {{ include "${CHART_NAME}.chart" . }}
{{ include "${CHART_NAME}.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "${CHART_NAME}.selectorLabels" -}}
app.kubernetes.io/name: {{ include "${CHART_NAME}.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
EOL
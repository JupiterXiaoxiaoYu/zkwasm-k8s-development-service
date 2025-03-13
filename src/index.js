require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const shell = require('shelljs');
const k8s = require('@kubernetes/client-node');
const axios = require('axios');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3020;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// 静态文件服务
app.use(express.static(path.join(__dirname, '../templates')));

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../templates/index.html'));
});

// 简化部署页面
app.get('/simple-deploy', (req, res) => {
  res.sendFile(path.join(__dirname, '../templates/simple-deploy.html'));
});

// 测试 Kubernetes 连接页面
app.get('/test-k8s', (req, res) => {
  res.sendFile(path.join(__dirname, '../templates/test-k8s.html'));
});

// 测试 Kubernetes 连接
app.get('/test-k8s-connection', async (req, res) => {
  try {
    // 初始化 Kubernetes 客户端
    const kc = new k8s.KubeConfig();
    
    if (process.env.KUBECONFIG_BASE64) {
      // 创建临时文件存储 kubeconfig
      const kubeconfigPath = path.join(os.tmpdir(), 'kubeconfig');
      fs.writeFileSync(kubeconfigPath, Buffer.from(process.env.KUBECONFIG_BASE64, 'base64').toString());
      
      // 从临时文件加载
      kc.loadFromFile(kubeconfigPath);
      
      // 清理临时文件
      fs.unlinkSync(kubeconfigPath);
    } else {
      // 尝试从默认位置加载
      kc.loadFromDefault();
    }
    
    // 获取当前上下文
    const currentContext = kc.getCurrentContext();
    
    // 创建 API 客户端
    const coreV1Api = kc.makeApiClient(k8s.CoreV1Api);
    
    // 获取命名空间列表
    const namespacesResponse = await coreV1Api.listNamespace();
    const namespaces = namespacesResponse.body.items.map(ns => ns.metadata.name);
    
    // 获取节点列表
    const nodesResponse = await coreV1Api.listNode();
    const nodes = nodesResponse.body.items.map(node => ({
      name: node.metadata.name,
      status: node.status.conditions.find(c => c.type === 'Ready')?.status || 'Unknown'
    }));
    
    res.json({
      success: true,
      message: 'Successfully connected to Kubernetes cluster',
      cluster: {
        currentContext,
        namespaces,
        nodes
      }
    });
  } catch (error) {
    console.error('Error connecting to Kubernetes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to connect to Kubernetes cluster',
      message: error.message,
      stack: error.stack
    });
  }
});

// API 路由
app.use('/api/deployments', require('./routes/deployments'));
app.use('/api/github', require('./routes/github'));
app.use('/api/helm', require('./routes/helm'));

// 健康检查端点
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// 启动服务器
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // 检查 kubeconfig 是否设置
  if (!process.env.KUBECONFIG_BASE64) {
    console.warn('KUBECONFIG_BASE64 environment variable is not set. Kubernetes operations will fail.');
  } else {
    // 测试 Kubernetes 连接
    console.log('Testing Kubernetes connection...');
    try {
      // 初始化 Kubernetes 客户端
      const kc = new k8s.KubeConfig();
      
      // 创建临时文件存储 kubeconfig
      const kubeconfigPath = path.join(os.tmpdir(), 'kubeconfig');
      fs.writeFileSync(kubeconfigPath, Buffer.from(process.env.KUBECONFIG_BASE64, 'base64').toString());
      
      // 从临时文件加载
      kc.loadFromFile(kubeconfigPath);
      
      // 清理临时文件
      fs.unlinkSync(kubeconfigPath);
      
      // 获取当前上下文
      const currentContext = kc.getCurrentContext();
      console.log(`Current Kubernetes context: ${currentContext}`);
      
      // 创建 API 客户端
      const coreV1Api = kc.makeApiClient(k8s.CoreV1Api);
      
      // 获取命名空间列表
      const namespacesResponse = await coreV1Api.listNamespace();
      const namespaces = namespacesResponse.body.items.map(ns => ns.metadata.name);
      console.log(`Available namespaces (${namespaces.length}): ${namespaces.slice(0, 5).join(', ')}${namespaces.length > 5 ? '...' : ''}`);
      
      // 获取节点列表
      const nodesResponse = await coreV1Api.listNode();
      const nodes = nodesResponse.body.items.map(node => ({
        name: node.metadata.name,
        status: node.status.conditions.find(c => c.type === 'Ready')?.status || 'Unknown'
      }));
      console.log(`Available nodes (${nodes.length}):`);
      nodes.forEach(node => {
        console.log(`  - ${node.name}: ${node.status === 'True' ? 'Ready' : 'Not Ready'}`);
      });
      
      console.log('✅ Successfully connected to Kubernetes cluster');
    } catch (error) {
      console.error('❌ Failed to connect to Kubernetes cluster:', error.message);
      console.error('Stack trace:', error.stack);
    }
  }
  
  // 检查 generate-helm 脚本是否存在
  const helmScriptPath = process.env.GENERATE_HELM_SCRIPT_PATH || '../devops/scripts/generate-helm.sh';
  if (!fs.existsSync(path.resolve(helmScriptPath))) {
    console.warn(`Helm script not found at ${helmScriptPath}. Helm chart generation will fail.`);
  }
}); 
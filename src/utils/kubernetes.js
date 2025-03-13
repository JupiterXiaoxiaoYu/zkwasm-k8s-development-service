const k8s = require('@kubernetes/client-node');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Initialize Kubernetes client
const initKubeConfig = () => {
  const kc = new k8s.KubeConfig();
  
  if (process.env.KUBECONFIG_BASE64) {
    // Create a temporary file to store the kubeconfig
    const kubeconfigPath = path.join(os.tmpdir(), 'kubeconfig');
    fs.writeFileSync(kubeconfigPath, Buffer.from(process.env.KUBECONFIG_BASE64, 'base64').toString());
    
    // Load from the temporary file
    kc.loadFromFile(kubeconfigPath);
    
    // Clean up the temporary file
    fs.unlinkSync(kubeconfigPath);
  } else {
    // Try to load from default location
    kc.loadFromDefault();
  }
  
  return kc;
};

// Get Kubernetes API clients
const getClients = () => {
  const kc = initKubeConfig();
  
  return {
    coreV1Api: kc.makeApiClient(k8s.CoreV1Api),
    appsV1Api: kc.makeApiClient(k8s.AppsV1Api),
    batchV1Api: kc.makeApiClient(k8s.BatchV1Api),
    networkingV1Api: kc.makeApiClient(k8s.NetworkingV1Api),
    customObjectsApi: kc.makeApiClient(k8s.CustomObjectsApi)
  };
};

// List namespaces
const listNamespaces = async () => {
  try {
    const { coreV1Api } = getClients();
    const res = await coreV1Api.listNamespace();
    return res.body.items;
  } catch (error) {
    console.error('Error listing namespaces:', error);
    throw error;
  }
};

// List deployments in a namespace
const listDeployments = async (namespace) => {
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  
  try {
    const { appsV1Api } = getClients();
    const res = await appsV1Api.listNamespacedDeployment(namespace);
    return res.body.items;
  } catch (error) {
    console.error(`Error listing deployments in namespace ${namespace}:`, error);
    throw error;
  }
};

// Get deployment details
const getDeployment = async (name, namespace) => {
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  
  try {
    const { appsV1Api } = getClients();
    const res = await appsV1Api.readNamespacedDeployment(name, namespace);
    return res.body;
  } catch (error) {
    console.error(`Error getting deployment ${name} in namespace ${namespace}:`, error);
    throw error;
  }
};

// Delete a deployment
const deleteDeployment = async (name, namespace) => {
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  
  try {
    const { appsV1Api } = getClients();
    const res = await appsV1Api.deleteNamespacedDeployment(name, namespace);
    return res.body;
  } catch (error) {
    console.error(`Error deleting deployment ${name} in namespace ${namespace}:`, error);
    throw error;
  }
};

module.exports = {
  initKubeConfig,
  getClients,
  listNamespaces,
  listDeployments,
  getDeployment,
  deleteDeployment
}; 
const express = require('express');
const router = express.Router();
const k8s = require('../utils/kubernetes');
const helm = require('../utils/helm');

// Get all deployments
router.get('/', async (req, res) => {
  try {
    const { namespace } = req.query;
    
    if (!namespace) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: namespace'
      });
    }
    
    const deployments = await k8s.listDeployments(namespace);
    
    res.json({
      success: true,
      data: deployments.map(deployment => ({
        name: deployment.metadata.name,
        namespace: deployment.metadata.namespace,
        replicas: deployment.spec.replicas,
        availableReplicas: deployment.status.availableReplicas || 0,
        createdAt: deployment.metadata.creationTimestamp,
        image: deployment.spec.template.spec.containers[0].image,
        labels: deployment.metadata.labels
      }))
    });
  } catch (error) {
    console.error('Error fetching deployments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch deployments',
      message: error.message
    });
  }
});

// Get deployment by name
router.get('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { namespace } = req.query;
    
    if (!namespace) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: namespace'
      });
    }
    
    const deployment = await k8s.getDeployment(name, namespace);
    
    res.json({
      success: true,
      data: deployment
    });
  } catch (error) {
    console.error(`Error fetching deployment ${req.params.name}:`, error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: `Failed to fetch deployment ${req.params.name}`,
      message: error.message
    });
  }
});

// Delete deployment
router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { namespace } = req.query;
    
    if (!namespace) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: namespace'
      });
    }
    
    await k8s.deleteDeployment(name, namespace);
    
    // Also delete the Helm release if it exists
    try {
      await helm.deleteHelmRelease(name, namespace);
    } catch (helmError) {
      console.warn(`Warning: Failed to delete Helm release ${name}: ${helmError.message}`);
    }
    
    res.json({
      success: true,
      message: `Deployment ${name} deleted successfully`
    });
  } catch (error) {
    console.error(`Error deleting deployment ${req.params.name}:`, error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: `Failed to delete deployment ${req.params.name}`,
      message: error.message
    });
  }
});

// Get Helm releases
router.get('/helm/releases', async (req, res) => {
  try {
    const { namespace } = req.query;
    
    if (!namespace) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: namespace'
      });
    }
    
    const releases = await helm.listHelmReleases(namespace);
    
    res.json({
      success: true,
      data: releases
    });
  } catch (error) {
    console.error('Error fetching Helm releases:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Helm releases',
      message: error.message
    });
  }
});

module.exports = router; 
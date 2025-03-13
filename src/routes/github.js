const express = require('express');
const router = express.Router();
const github = require('../utils/github');

// Get repository information
router.get('/repos/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const repoInfo = await github.getRepository(owner, repo);
    
    res.json({
      success: true,
      data: repoInfo
    });
  } catch (error) {
    console.error(`Error fetching repository ${req.params.owner}/${req.params.repo}:`, error);
    res.status(error.response?.status || 500).json({
      success: false,
      error: `Failed to fetch repository ${req.params.owner}/${req.params.repo}`,
      message: error.message
    });
  }
});

// List packages (container images) for a user/organization
router.get('/packages/:owner', async (req, res) => {
  try {
    const { owner } = req.params;
    const packageType = req.query.type || 'container';
    
    const packages = await github.listPackages(owner, packageType);
    
    res.json({
      success: true,
      data: packages
    });
  } catch (error) {
    console.error(`Error listing packages for ${req.params.owner}:`, error);
    res.status(error.response?.status || 500).json({
      success: false,
      error: `Failed to list packages for ${req.params.owner}`,
      message: error.message
    });
  }
});

// Get package versions
router.get('/packages/:owner/:packageName/versions', async (req, res) => {
  try {
    const { owner, packageName } = req.params;
    const packageType = req.query.type || 'container';
    
    const versions = await github.getPackageVersions(owner, packageName, packageType);
    
    res.json({
      success: true,
      data: versions
    });
  } catch (error) {
    console.error(`Error fetching versions for package ${req.params.packageName}:`, error);
    res.status(error.response?.status || 500).json({
      success: false,
      error: `Failed to fetch versions for package ${req.params.packageName}`,
      message: error.message
    });
  }
});

// Check if an image exists
router.get('/images/:owner/:imageName/:tag', async (req, res) => {
  try {
    const { owner, imageName, tag } = req.params;
    
    const exists = await github.checkImageExists(owner, imageName, tag);
    
    res.json({
      success: true,
      exists,
      imageUrl: `ghcr.io/${owner}/${imageName}:${tag}`
    });
  } catch (error) {
    console.error(`Error checking if image ${req.params.owner}/${req.params.imageName}:${req.params.tag} exists:`, error);
    res.status(error.response?.status || 500).json({
      success: false,
      error: `Failed to check if image ${req.params.owner}/${req.params.imageName}:${req.params.tag} exists`,
      message: error.message
    });
  }
});

module.exports = router; 
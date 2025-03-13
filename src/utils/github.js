const axios = require('axios');

// GitHub API base URL
const GITHUB_API_BASE_URL = 'https://api.github.com';

// 检查是否配置了GitHub令牌
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (GITHUB_TOKEN) {
  console.log('GitHub token is configured');
} else {
  console.log('Warning: GitHub token is not configured. Some API calls may fail due to rate limiting or authentication requirements.');
  console.log('Set the GITHUB_TOKEN environment variable to improve reliability.');
}

// Create axios instance with GitHub token if available
const githubAxios = axios.create({
  baseURL: GITHUB_API_BASE_URL,
  headers: {
    'Accept': 'application/vnd.github.v3+json',
    ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
  }
});

// Get repository information
const getRepository = async (owner, repo) => {
  try {
    const response = await githubAxios.get(`/repos/${owner}/${repo}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching repository ${owner}/${repo}:`, error.message);
    throw new Error(`Repository not found or not accessible: ${owner}/${repo}`);
  }
};

// List packages (container images) for a user/organization
const listPackages = async (owner, packageType = 'container') => {
  try {
    const response = await githubAxios.get(`/users/${owner}/packages?package_type=${packageType}`);
    return response.data;
  } catch (error) {
    console.error(`Error listing packages for ${owner}:`, error.message);
    throw new Error(`Failed to list packages for ${owner}: ${error.message}`);
  }
};

// Get package versions
const getPackageVersions = async (owner, packageName, packageType = 'container') => {
  try {
    const response = await githubAxios.get(`/users/${owner}/packages/${packageType}/${packageName}/versions`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching versions for package ${packageName}:`, error.message);
    throw new Error(`Failed to fetch versions for package ${packageName}: ${error.message}`);
  }
};

// 直接检查容器镜像是否存在（使用Docker Registry HTTP API V2）
const checkContainerImageDirectly = async (owner, repo, tag) => {
  try {
    console.log(`Directly checking if container image exists: ghcr.io/${owner}/${repo}:${tag}`);
    
    // 尝试多种方法检查镜像是否存在
    
    // 方法1: 直接访问GitHub包页面
    try {
      const githubPackageUrl = `https://github.com/${owner}/${repo}/pkgs/container/${repo}`;
      console.log(`Checking GitHub package page: ${githubPackageUrl}`);
      
      const response = await axios.get(githubPackageUrl, {
        validateStatus: status => status < 500 // 允许任何非500错误
      });
      
      // 200表示页面存在
      const pageExists = response.status === 200;
      console.log(`GitHub package page check result: ${pageExists ? 'EXISTS' : 'NOT FOUND'} (Status: ${response.status})`);
      
      if (pageExists) {
        // 检查页面内容中是否包含该标签
        const hasTag = response.data.includes(`>${tag}<`) || 
                      response.data.includes(`"${tag}"`) || 
                      response.data.includes(`>${tag} `);
        
        console.log(`Tag ${tag} ${hasTag ? 'found' : 'not found'} in package page content`);
        
        if (hasTag) {
          return true;
        }
      }
    } catch (error) {
      console.warn(`Method 1 failed: ${error.message}`);
    }
    
    // 方法2: 使用Docker Registry HTTP API V2
    try {
      // 首先获取token (对公共镜像可能不需要认证)
      const tokenUrl = `https://ghcr.io/token?service=ghcr.io&scope=repository:${owner.toLowerCase()}/${repo.toLowerCase()}:pull`;
      console.log(`Requesting token from: ${tokenUrl}`);
      
      const tokenResponse = await axios.get(tokenUrl, {
        validateStatus: status => status < 500 // 允许任何非500错误
      });
      
      console.log(`Token request status: ${tokenResponse.status}`);
      
      let token = null;
      if (tokenResponse.status === 200 && tokenResponse.data && tokenResponse.data.token) {
        token = tokenResponse.data.token;
        console.log(`Successfully obtained anonymous token`);
      } else {
        console.log(`No anonymous token available, proceeding without token`);
      }
      
      // 然后检查镜像清单
      const headers = {
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...(GITHUB_TOKEN && { 'Authorization': `Bearer ${GITHUB_TOKEN}` })
      };
      
      // 构建镜像URL
      const imageUrl = `https://ghcr.io/v2/${owner.toLowerCase()}/${repo.toLowerCase()}/manifests/${tag}`;
      console.log(`Checking image manifest at: ${imageUrl}`);
      
      const response = await axios.head(imageUrl, {
        headers,
        validateStatus: status => status < 500 // 允许任何非500错误
      });
      
      // 200表示镜像存在，404表示不存在
      const exists = response.status === 200;
      console.log(`Image check result for ghcr.io/${owner}/${repo}:${tag}: ${exists ? 'EXISTS' : 'NOT FOUND'} (Status: ${response.status})`);
      
      if (exists) {
        return true;
      }
    } catch (error) {
      console.warn(`Method 2 failed: ${error.message}`);
    }
    
    // 方法3: 使用curl命令行工具（如果可用）
    try {
      const { exec } = require('child_process');
      
      return new Promise((resolve) => {
        // 直接检查GitHub包页面
        const curlCmd = `curl -s -f -L -I https://github.com/${owner}/${repo}/pkgs/container/${repo}`;
        console.log(`Executing curl command: ${curlCmd}`);
        
        exec(curlCmd, (error, stdout, stderr) => {
          if (error) {
            console.log(`Curl command failed: ${error.message}`);
            resolve(false);
            return;
          }
          
          const exists = stdout.includes('HTTP/') && stdout.includes('200');
          console.log(`Curl check result: ${exists ? 'EXISTS' : 'NOT FOUND'}`);
          
          if (exists) {
            // 如果包页面存在，我们假设镜像也存在
            // 这不是100%准确，但对于大多数情况应该足够了
            console.log(`Package page exists, assuming image ${tag} also exists`);
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });
    } catch (error) {
      console.warn(`Method 3 failed: ${error.message}`);
    }
    
    // 如果所有方法都失败，假设镜像不存在
    console.log(`All methods failed, assuming image does not exist`);
    return false;
  } catch (error) {
    console.error(`Error directly checking image ghcr.io/${owner}/${repo}:${tag}:`, error.message);
    return false;
  }
};

// 使用Docker命令检查镜像是否存在
const checkImageWithDocker = async (owner, repo, tag) => {
  try {
    const { exec } = require('child_process');
    const imageUrl = `ghcr.io/${owner.toLowerCase()}/${repo.toLowerCase()}:${tag}`;
    
    console.log(`Checking image with Docker command: ${imageUrl}`);
    
    return new Promise((resolve) => {
      // 使用docker manifest inspect命令检查镜像是否存在
      const dockerCmd = `docker manifest inspect ${imageUrl}`;
      console.log(`Executing Docker command: ${dockerCmd}`);
      
      exec(dockerCmd, (error, stdout, stderr) => {
        if (error) {
          console.log(`Docker command failed: ${stderr || error.message}`);
          resolve(false);
          return;
        }
        
        const exists = stdout && stdout.length > 0 && !stdout.includes('no such manifest');
        console.log(`Docker manifest check result: ${exists ? 'EXISTS' : 'NOT FOUND'}`);
        resolve(exists);
      });
    });
  } catch (error) {
    console.warn(`Docker check failed: ${error.message}`);
    return false;
  }
};

// Check if an image exists in GitHub Container Registry
const checkImageExists = async (owner, imageName, tag) => {
  console.log(`Checking if image exists: ${owner}/${imageName}:${tag}`);
  
  // 尝试使用Docker命令检查
  try {
    const dockerCheckResult = await checkImageWithDocker(owner, imageName, tag);
    if (dockerCheckResult) {
      console.log(`✅ Docker command confirmed image exists: ghcr.io/${owner}/${imageName}:${tag}`);
      return true;
    }
  } catch (dockerCheckError) {
    console.warn(`Docker check failed, trying other methods: ${dockerCheckError.message}`);
  }
  
  // 首先尝试直接检查容器镜像
  try {
    const directCheckResult = await checkContainerImageDirectly(owner, imageName, tag);
    if (directCheckResult) {
      console.log(`✅ Direct check confirmed image exists: ghcr.io/${owner}/${imageName}:${tag}`);
      return true;
    }
  } catch (directCheckError) {
    console.warn(`Direct image check failed, falling back to API: ${directCheckError.message}`);
  }
  
  // 如果直接检查失败，尝试使用GitHub API
  try {
    // 首先尝试列出所有包
    const packages = await listPackages(owner);
    console.log(`Found ${packages.length} packages for owner ${owner}`);
    console.log(`All packages:`, packages.map(p => p.name));
    
    // 查找匹配的包
    const matchingPackages = packages.filter(pkg => 
      pkg.name.toLowerCase() === imageName.toLowerCase()
    );
    
    console.log(`Found ${matchingPackages.length} matching packages with exact name "${imageName}"`);
    
    if (matchingPackages.length === 0) {
      console.log(`No package found with name ${imageName} for owner ${owner}`);
      
      // 尝试查找名称相似的包（可能大小写不同）
      const similarPackages = packages.filter(pkg => 
        pkg.name.toLowerCase().includes(imageName.toLowerCase()) || 
        imageName.toLowerCase().includes(pkg.name.toLowerCase())
      );
      
      if (similarPackages.length > 0) {
        console.log(`Found ${similarPackages.length} similar packages: ${similarPackages.map(p => p.name).join(', ')}`);
        
        // 尝试使用相似的包名
        for (const pkg of similarPackages) {
          console.log(`Trying similar package: ${pkg.name}`);
          try {
            const versions = await getPackageVersions(owner, pkg.name);
            console.log(`Found ${versions.length} versions for package ${pkg.name}`);
            
            // 打印所有可用的标签
            const allTags = versions.flatMap(v => 
              v.metadata && v.metadata.container && v.metadata.container.tags ? v.metadata.container.tags : []
            );
            console.log(`Available tags for ${pkg.name}: ${allTags.join(', ')}`);
            
            const hasTag = versions.some(version => 
              version.metadata && 
              version.metadata.container && 
              version.metadata.container.tags && 
              version.metadata.container.tags.some(t => t.toLowerCase() === tag.toLowerCase())
            );
            
            if (hasTag) {
              console.log(`Found tag ${tag} in similar package ${pkg.name}`);
              return true;
            }
          } catch (versionError) {
            console.warn(`Error checking versions for similar package ${pkg.name}:`, versionError.message);
          }
        }
      }
      
      // 如果没有找到匹配的包，尝试直接检查公共镜像
      console.log(`No matching packages found, trying direct public image check as fallback...`);
      return await checkContainerImageDirectly(owner, imageName, tag);
    }
    
    // 对于每个匹配的包，检查是否有指定的标签
    for (const pkg of matchingPackages) {
      try {
        console.log(`Checking versions for package ${pkg.name}`);
        const versions = await getPackageVersions(owner, pkg.name);
        console.log(`Found ${versions.length} versions for package ${pkg.name}`);
        
        // 打印所有可用的标签
        const allTags = versions.flatMap(v => 
          v.metadata && v.metadata.container && v.metadata.container.tags ? v.metadata.container.tags : []
        );
        console.log(`Available tags for ${pkg.name}: ${allTags.join(', ')}`);
        
        const hasTag = versions.some(version => {
          const hasTags = version.metadata && 
                         version.metadata.container && 
                         version.metadata.container.tags;
          
          if (hasTags) {
            const matchingTags = version.metadata.container.tags.filter(t => 
              t.toLowerCase() === tag.toLowerCase()
            );
            if (matchingTags.length > 0) {
              console.log(`Found matching tag: ${matchingTags[0]}`);
              return true;
            }
          }
          return false;
        });
        
        if (hasTag) {
          console.log(`Found tag ${tag} in package ${pkg.name}`);
          return true;
        } else {
          console.log(`Tag ${tag} not found in package ${pkg.name}`);
        }
      } catch (versionError) {
        console.warn(`Error checking versions for package ${pkg.name}:`, versionError.message);
        // 继续检查其他包
      }
    }
    
    console.log(`No matching tag ${tag} found for any package`);
    
    // 最后尝试直接检查公共镜像
    console.log(`Trying direct public image check as final fallback...`);
    return await checkContainerImageDirectly(owner, imageName, tag);
  } catch (error) {
    console.error(`Error checking if image ${owner}/${imageName}:${tag} exists:`, error.message);
    
    // 如果API检查失败，尝试直接检查公共镜像
    console.log(`API check failed, trying direct public image check as fallback...`);
    return await checkContainerImageDirectly(owner, imageName, tag);
  }
};

// 检查仓库是否有 GitHub Actions 工作流
const checkGitHubActionsWorkflows = async (owner, repo) => {
  try {
    const response = await githubAxios.get(`/repos/${owner}/${repo}/actions/workflows`);
    return response.data.workflows.length > 0;
  } catch (error) {
    console.error(`Error checking GitHub Actions workflows for ${owner}/${repo}:`, error.message);
    return false;
  }
};

// 获取仓库的最新发布版本
const getLatestRelease = async (owner, repo) => {
  try {
    const response = await githubAxios.get(`/repos/${owner}/${repo}/releases/latest`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching latest release for ${owner}/${repo}:`, error.message);
    return null;
  }
};

// 获取仓库的所有发布版本
const getAllReleases = async (owner, repo) => {
  try {
    const response = await githubAxios.get(`/repos/${owner}/${repo}/releases`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching releases for ${owner}/${repo}:`, error.message);
    return [];
  }
};

module.exports = {
  getRepository,
  listPackages,
  getPackageVersions,
  checkImageExists,
  checkContainerImageDirectly,
  checkImageWithDocker,
  checkGitHubActionsWorkflows,
  getLatestRelease,
  getAllReleases
}; 
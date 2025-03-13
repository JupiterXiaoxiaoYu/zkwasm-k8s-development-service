const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const helm = require('../utils/helm');
const github = require('../utils/github');
const crypto = require('crypto');
const shell = require('shelljs');

// 从 GitHub URL 中提取 owner、repo 和 branch
function extractGitHubInfo(url) {
  // 支持多种 GitHub URL 格式
  // 例如: https://github.com/owner/repo
  //      https://github.com/owner/repo.git
  //      https://github.com/owner/repo/tree/branch
  //      git@github.com:owner/repo.git
  //      @https://github.com/owner/repo/tree/branch
  let owner = null;
  let repo = null;
  let branch = null;
  
  console.log(`Parsing GitHub URL: ${url}`);
  
  try {
    // 移除URL开头可能的@符号
    if (url.startsWith('@')) {
      url = url.substring(1);
      console.log(`Removed @ prefix, new URL: ${url}`);
    }
    
    // 处理 HTTPS URL
    if (url.includes('github.com') && (url.startsWith('http://') || url.startsWith('https://'))) {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part.trim() !== '');
      
      console.log(`URL path parts:`, pathParts);
      
      if (pathParts.length >= 2) {
        owner = pathParts[0];
        repo = pathParts[1].replace('.git', ''); // 移除可能的 .git 后缀
        
        // 检查是否包含分支信息 (格式: /tree/branch)
        if (pathParts.length >= 4 && pathParts[2] === 'tree') {
          branch = pathParts[3];
        }
      }
    } 
    // 处理 SSH URL (格式: git@github.com:owner/repo.git)
    else if (url.includes('@github.com:')) {
      const parts = url.split('@github.com:')[1].split('/');
      console.log(`SSH URL parts:`, parts);
      
      if (parts.length >= 2) {
        owner = parts[0];
        repo = parts[1].replace('.git', ''); // 移除可能的 .git 后缀
      }
    }
  } catch (error) {
    console.error(`Error parsing GitHub URL: ${error.message}`);
  }
  
  console.log(`Extracted GitHub info - Owner: ${owner}, Repo: ${repo}, Branch: ${branch}`);
  return { owner, repo, branch };
}

// 生成唯一的 release name
function generateReleaseName(repoName, namespace) {
  // 确保 release name 符合 Kubernetes 命名规范（小写字母、数字和连字符）
  const sanitizedRepoName = repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const sanitizedNamespace = namespace.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  
  // 使用固定格式的release名称，不再添加随机后缀
  return `${sanitizedRepoName}-${sanitizedNamespace.substring(0, 8)}`.substring(0, 53);
}

// 检查 GitHub 仓库并部署 Helm chart
router.post('/deploy-from-github', async (req, res) => {
  try {
    const { githubUrl, namespace, envVars = {}, forceImageTag = false, forceUpgrade = false, forceRestart = false } = req.body;
    
    if (!githubUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: githubUrl'
      });
    }
    
    if (!namespace) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: namespace'
      });
    }
    
    // 从 GitHub URL 中提取 owner、repo 和 branch
    const { owner, repo, branch } = extractGitHubInfo(githubUrl);
    
    console.log(`Extracted GitHub info - URL: ${githubUrl}, Owner: ${owner}, Repo: ${repo}, Branch: ${branch}`);
    
    if (!owner || !repo) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GitHub URL. Could not extract owner and repository name.'
      });
    }
    
    console.log(`Deploying from GitHub: ${owner}/${repo}${branch ? ` (branch: ${branch})` : ''}`);
    
    // 检查仓库是否存在
    try {
      await github.getRepository(owner, repo);
    } catch (error) {
      console.error(`Repository check failed: ${error.message}`);
      return res.status(400).json({
        success: false,
        error: `GitHub repository ${owner}/${repo} not found or not accessible.`,
        details: error.message
      });
    }
    
    // 确定要检查的镜像标签
    let imageTag = 'latest';
    let imageCheckSuccess = false;
    
    // 如果指定了分支，尝试查找该分支对应的镜像
    if (branch) {
      console.log(`Branch specified: ${branch}, checking for corresponding image tags`);
      
      // 如果强制使用镜像标签，跳过镜像检查
      if (forceImageTag) {
        console.log(`Force image tag enabled, using branch as image tag without checking: ${branch}`);
        imageTag = branch;
        imageCheckSuccess = true;
      } else {
        // 首先检查是否同时存在latest和branch标签
        const latestImageExists = await github.checkImageExists(owner, repo, 'latest');
        const branchImageExists = await github.checkImageExists(owner, repo, branch);
        
        if (latestImageExists && branchImageExists) {
          // 如果两者都存在，优先使用branch标签
          imageTag = branch;
          imageCheckSuccess = true;
          console.log(`✅ Found both 'latest' and branch '${branch}' images, using branch image`);
        } else if (latestImageExists) {
          // 如果只有latest标签存在
          imageTag = 'latest';
          imageCheckSuccess = true;
          console.log(`✅ Found 'latest' image, branch image not found, using 'latest'`);
        } else if (branchImageExists) {
          // 如果只有branch标签存在
          imageTag = branch;
          imageCheckSuccess = true;
          console.log(`✅ Found image for branch: ${branch}`);
        } else {
          // 尝试一些常见的分支标签格式
          const possibleTags = [
            branch,
            `branch-${branch}`,
            branch.replace(/\//g, '-'),  // 将 feature/xyz 转换为 feature-xyz
            branch.toLowerCase(), // 尝试小写版本
          ];
          
          // 移除重复的标签
          const uniqueTags = [...new Set(possibleTags)];
          console.log(`Trying possible tags for branch ${branch}:`, uniqueTags);
          
          for (const tag of uniqueTags) {
            console.log(`Checking tag: ${tag}`);
            const tagExists = await github.checkImageExists(owner, repo, tag);
            if (tagExists) {
              imageTag = tag;
              imageCheckSuccess = true;
              console.log(`✅ Found image with tag: ${tag}`);
              break;
            }
          }
          
          // 如果找不到分支对应的镜像，检查是否有 latest 镜像
          if (!imageCheckSuccess) {
            console.log(`No branch-specific image found, checking for 'latest' tag`);
            if (latestImageExists) {
              imageTag = 'latest';
              imageCheckSuccess = true;
              console.log(`✅ Using 'latest' image instead of branch-specific image`);
            } else {
              // 尝试直接检查镜像
              console.log(`No 'latest' image found via API, trying direct check...`);
              const directCheckResult = await github.checkContainerImageDirectly(owner, repo, branch);
              if (directCheckResult) {
                imageTag = branch;
                imageCheckSuccess = true;
                console.log(`✅ Direct check confirmed image exists: ghcr.io/${owner}/${repo}:${branch}`);
              } else if (forceImageTag) {
                // 如果强制使用镜像标签，即使检查失败也使用分支作为标签
                console.log(`Force image tag enabled, using branch as image tag despite check failure: ${branch}`);
                imageTag = branch;
                imageCheckSuccess = true;
              } else {
                return res.status(400).json({
                  success: false,
                  error: `No image found for branch '${branch}' and no 'latest' image found for ${owner}/${repo}. Please ensure the repository has a published container image or enable 'Force use branch as image tag' option.`,
                  details: `Tried tags: ${uniqueTags.join(', ')}, latest`
                });
              }
            }
          }
        }
      }
    } else {
      // 如果没有指定分支，检查是否有 latest 镜像
      console.log(`No branch specified, checking for 'latest' tag`);
      const imageExists = await github.checkImageExists(owner, repo, 'latest');
      if (imageExists) {
        imageCheckSuccess = true;
        console.log(`✅ Found 'latest' image`);
      } else if (forceImageTag) {
        // 如果强制使用镜像标签，即使检查失败也使用latest
        console.log(`Force image tag enabled, using 'latest' tag despite check failure`);
        imageCheckSuccess = true;
      } else {
        return res.status(400).json({
          success: false,
          error: `No 'latest' image found for ${owner}/${repo}. Please ensure the repository has a published container image or enable 'Force use branch as image tag' option.`
        });
      }
    }
    
    console.log(`Using image tag: ${imageTag} (success: ${imageCheckSuccess})`);
    
    // 使用 repo 名称作为 Chart Name
    const chartName = repo;
    console.log(`Using repository name as chart name: ${chartName}`);
    
    // 生成唯一的 Release Name
    let releaseName = generateReleaseName(repo, namespace);
    let upgradeOnly = false;
    
    // 检查是否已经存在相同chart的发布
    const existingRelease = await helm.checkReleaseExists(namespace, chartName);
    
    if (existingRelease.exists) {
      console.log(`✅ EXISTING RELEASE FOUND: ${existingRelease.releaseName} in namespace ${namespace}`);
      console.log(`Release details: ${JSON.stringify(existingRelease.releases[0], null, 2)}`);
      
      if (forceUpgrade) {
        // 如果启用了强制升级，使用现有的release名称
        console.log(`Found existing release. Using existing release name: ${existingRelease.releaseName} for upgrade`);
        releaseName = existingRelease.releaseName;
        upgradeOnly = true;
        
        // 记录现有release的信息，用于调试
        console.log(`Existing release details:`, JSON.stringify(existingRelease.releases[0], null, 2));
      } else {
        return res.status(409).json({
          success: false,
          error: 'Existing deployment detected',
          code: 'EXISTING_DEPLOYMENT',
          message: `🔄 UPGRADE REQUIRED: ${chartName} is already deployed in the ${namespace} namespace.`,
          details: {
            namespace,
            chartName,
            existingReleases: existingRelease.releases.map(r => ({
              name: r.name,
              chart: r.chart,
              status: r.status,
              updated: r.updated,
              revision: r.revision || 'unknown'
            })),
            currentRelease: existingRelease.releaseName,
            currentStatus: existingRelease.releases[0]?.status || 'unknown'
          },
          action: 'upgrade',
          actionMessage: 'To update this application, please enable the "Force Upgrade" option and try again.',
          helpText: 'Enabling "Force Upgrade" will update the existing deployment with your new configuration.',
          buttonText: 'Enable Force Upgrade and Deploy',
          buttonAction: 'upgrade',
          timestamp: new Date().toISOString(),
          requiresUpgrade: true,
          upgradeInfo: {
            releaseName: existingRelease.releaseName,
            currentRevision: existingRelease.releases[0]?.revision || 'unknown',
            lastDeployed: existingRelease.releases[0]?.updated || new Date().toISOString()
          }
        });
      }
    }
    
    // 准备环境变量
    const helmEnvVars = {
      CHART_NAME: chartName, // 确保使用从GitHub URL中提取的repo名称作为chart名称
      GITHUB_OWNER: owner.toLowerCase(), // 确保传递GitHub所有者信息
      CHAIN_ID: envVars.chainId || "11155111",
      ALLOWED_ORIGINS: envVars.allowedOrigins || "*",
      CHART_PATH: `./helm-charts/${chartName}`,
      DEPLOY_VALUE: envVars.deployValue || "TRUE",
      REMOTE_VALUE: envVars.remoteValue || "TRUE",
      AUTO_SUBMIT_VALUE: envVars.autoSubmitValue || "",
      MIGRATE_VALUE: envVars.migrateValue || "FALSE",
      MIGRATE_IMAGE_VALUE: envVars.migrateImageValue || "",
      IMAGE_VALUE: envVars.imageValue || "",
      SETTLEMENT_CONTRACT_ADDRESS: envVars.settlementContractAddress || "",
      RPC_PROVIDER: envVars.rpcProvider || "",
    };
    
    // 准备 Helm 部署的值
    let values = {
      config: {
        app: {
          customEnv: {}
        }
      }
    };
    
    // 添加自定义环境变量，不再使用custom_前缀
    if (envVars.custom && typeof envVars.custom === 'object') {
      // 过滤掉值为undefined或null的自定义环境变量
      const filteredCustomEnvs = Object.entries(envVars.custom)
        .filter(([_, value]) => value !== undefined && value !== null)
        .reduce((acc, [key, value]) => {
          // 直接使用原始键名，不添加前缀
          acc[key] = value;
          return acc;
        }, {});
      
      // 将过滤后的自定义环境变量添加到values.config.app.customEnv中，而不是helmEnvVars
      values.config.app.customEnv = filteredCustomEnvs;
      
      console.log(`添加了 ${Object.keys(filteredCustomEnvs).length} 个自定义环境变量到values.config.app.customEnv`);
      // 打印每个自定义环境变量的名称，帮助调试
      Object.keys(filteredCustomEnvs).forEach(key => {
        console.log(`  - 自定义环境变量: ${key}`);
      });
    } else {
      console.log('没有自定义环境变量需要添加');
    }
    
    console.log(`Generating Helm chart with environment variables:`, helmEnvVars);
    
    // 生成 Helm chart
    const { chartPath, tempDir } = await helm.generateHelmChart(helmEnvVars);
    
    if (upgradeOnly) {
      // 如果是升级操作，获取现有release的值
      const existingValues = await helm.getHelmReleaseValues(releaseName, namespace);
      
      // 只更新镜像相关的值，保留其他现有值
      values = {
        ...existingValues,
        image: {
          repository: `ghcr.io/${owner.toLowerCase()}/${chartName}`,
          tag: imageTag,
          pullPolicy: 'Always' // 确保每次都拉取最新镜像
        },
        // 确保正确处理podAnnotations
        podAnnotations: {
          ...(existingValues.podAnnotations || {}),
          // 如果需要强制重启Pod，添加时间戳注解
          ...(forceRestart ? { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } : {})
        },
        config: {
          ...(existingValues.config || {}),
          app: {
            ...(existingValues.config?.app || {}),
            ...values.config?.app, // 保留我们之前设置的自定义环境变量
            // 确保IMAGE_VALUE和MIGRATE_IMAGE_VALUE被正确设置
            image: envVars.imageValue || existingValues.config?.app?.image || "",
            migrateImageValue: envVars.migrateImageValue || existingValues.config?.app?.migrateImageValue || ""
          }
        }
      };
      
      console.log(`Upgrading existing release with merged values to preserve configuration`);
      
      // 如果强制升级，检查是否有Ingress资源，但不删除它们
      if (forceUpgrade) {
        try {
          console.log(`Force upgrade enabled, checking for existing Ingress resources...`);
          
          // 使用kubectl获取所有与当前chart相关的Ingress资源
          const ingressResult = shell.exec(
            `kubectl get ingress -n ${namespace} -l app.kubernetes.io/instance=${releaseName} -o json`,
            { silent: true }
          );
          
          if (ingressResult.code === 0) {
            const ingressList = JSON.parse(ingressResult.stdout);
            if (ingressList.items && ingressList.items.length > 0) {
              console.log(`Found ${ingressList.items.length} existing Ingress resources for release ${releaseName}`);
              console.log(`Will attempt to upgrade without modifying existing Ingress resources`);
              
              // 在values中设置ingress.enabled=false，避免创建新的Ingress
              values.ingress = {
                ...values.ingress,
                enabled: false
              };
              
              console.log(`Set ingress.enabled=false to avoid conflicts with existing Ingress resources`);
            } else {
              console.log(`No existing Ingress resources found for release ${releaseName}`);
            }
          } else {
            console.warn(`Failed to get Ingress resources: ${ingressResult.stderr}`);
          }
        } catch (error) {
          console.error(`Error handling Ingress resources: ${error.message}`);
          // 继续执行，不中断流程
        }
      }
    } else {
      // 如果是新部署，传递所有值
      values = {
        ...values, // 保留之前设置的值，包括自定义环境变量
        image: {
          repository: `ghcr.io/${owner.toLowerCase()}/${chartName}`,
          tag: imageTag,
          pullPolicy: 'Always' // 确保每次都拉取最新镜像
        },
        // 确保不覆盖podAnnotations，而是合并它们
        podAnnotations: {
          ...(values.podAnnotations || {}),
          ...(req.body.values?.podAnnotations || {}),
          // 添加时间戳注解，强制Kubernetes重新拉取镜像
          'kubectl.kubernetes.io/restartedAt': new Date().toISOString()
        },
        ...req.body.values,
        // 再次确保podAnnotations和image不被完全覆盖
        podAnnotations: {
          ...(values.podAnnotations || {}),
          ...(req.body.values?.podAnnotations || {}),
          'kubectl.kubernetes.io/restartedAt': new Date().toISOString()
        },
        image: {
          repository: `ghcr.io/${owner.toLowerCase()}/${chartName}`,
          tag: imageTag,
          pullPolicy: 'Always'
        },
        // 确保config.app存在并包含必要的值
        config: {
          ...(values.config || {}),
          app: {
            ...(values.config?.app || {}),
            // 确保IMAGE_VALUE和MIGRATE_IMAGE_VALUE被正确设置
            image: envVars.imageValue || "",
            migrateImageValue: envVars.migrateImageValue || "",
            // 设置其他环境变量
            deploy: envVars.deployValue || "TRUE",
            remote: envVars.remoteValue || "TRUE",
            autoSubmit: envVars.autoSubmitValue || "",
            migrate: envVars.migrateValue || "FALSE",
            settlementContractAddress: envVars.settlementContractAddress || "",
            rpcProvider: envVars.rpcProvider || ""
          }
        }
      };
      
      // 添加自定义环境变量到values中
      if (envVars.custom && typeof envVars.custom === 'object') {
        // 过滤掉undefined或null的值
        const filteredCustomEnvs = Object.fromEntries(
          Object.entries(envVars.custom).filter(([_, value]) => value !== undefined && value !== null)
        );
        
        // 确保values.config.app.customEnv存在
        if (!values.config) values.config = {};
        if (!values.config.app) values.config.app = {};
        
        // 直接使用原始键名，不添加前缀
        values.config.app.customEnv = {
          ...values.config.app.customEnv, // 保留现有的自定义环境变量
          ...filteredCustomEnvs
        };
        
        console.log(`添加了 ${Object.keys(filteredCustomEnvs).length} 个自定义环境变量，不添加前缀`);
        // 打印每个自定义环境变量的名称，用于调试
        Object.keys(filteredCustomEnvs).forEach(key => {
          console.log(`  - 自定义环境变量: ${key}`);
        });
        
        // 打印最终的自定义环境变量对象
        console.log('最终的自定义环境变量对象:', JSON.stringify(values.config.app.customEnv, null, 2));
      } else {
        console.log('没有自定义环境变量需要添加');
        // 确保customEnv对象存在，即使为空
        if (!values.config) values.config = {};
        if (!values.config.app) values.config.app = {};
        values.config.app.customEnv = values.config.app.customEnv || {};
      }
    }
    
    // 打印最终的values对象，特别是自定义环境变量部分
    console.log(`Final values for deployment:`);
    if (values.config && values.config.app && values.config.app.customEnv) {
      console.log(`Custom environment variables in values:`, JSON.stringify(values.config.app.customEnv, null, 2));
      console.log(`Total custom environment variables: ${Object.keys(values.config.app.customEnv).length}`);
    } else {
      console.log(`No custom environment variables in final values`);
    }
    
    // 打印IMAGE_VALUE和MIGRATE_IMAGE_VALUE的值
    console.log(`IMAGE_VALUE in values: "${values.config?.app?.image || ''}"`);
    console.log(`MIGRATE_IMAGE_VALUE in values: "${values.config?.app?.migrateImageValue || ''}"`);
    
    // 打印完整的values对象，用于调试
    console.log(`Complete values object:`, JSON.stringify(values, null, 2));
    
    try {
      // 部署 Helm chart
      const deployResult = await helm.deployHelmChart(chartPath, releaseName, namespace, values, upgradeOnly, forceUpgrade, forceRestart);
      
      // 获取实际使用的镜像标签（不再添加时间戳）
      const actualImageTag = values.image && values.image.tag ? values.image.tag : imageTag;
      const originalImageTag = imageTag;
      console.log(`Deployment completed with image tag: ${actualImageTag} (original: ${originalImageTag})`);
      
      // 清理临时目录
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      const actionType = (upgradeOnly || deployResult.isUpgrade || (deployResult.message && deployResult.message.includes('has been upgraded'))) ? 'upgraded' : 'deployed';
      let ingressStatus = 'created';
      
      // 检查是否禁用了Ingress创建
      if (values.ingress && values.ingress.enabled === false) {
        ingressStatus = 'preserved';
      } else if (deployResult.ingressDisabled) {
        ingressStatus = 'disabled';
      }
      
      // 构建更明确的英文提示消息
      let statusMessage = '';
      const isUpgradeOperation = (upgradeOnly || deployResult.isUpgrade || (deployResult.message && deployResult.message.includes('has been upgraded')));
      let statusIcon = isUpgradeOperation ? '🔄' : '✅';
      let statusAction = isUpgradeOperation ? 'UPGRADE' : 'DEPLOYMENT';
      
      if (isUpgradeOperation) {
        statusMessage = `${statusIcon} ${statusAction} SUCCESSFUL: ${chartName} has been upgraded in the ${namespace} namespace.`;
        if (deployResult.retried) {
          statusMessage += ' (Retry was required due to network issues)';
        }
      } else {
        statusMessage = `${statusIcon} ${statusAction} SUCCESSFUL: ${chartName} has been deployed to the ${namespace} namespace.`;
      }
      
      // 添加Ingress状态信息
      let ingressMessage = '';
      if (ingressStatus === 'preserved') {
        ingressMessage = 'Existing Ingress configuration has been preserved.';
      } else if (ingressStatus === 'disabled') {
        ingressMessage = 'Ingress creation was disabled to avoid conflicts.';
      } else {
        ingressMessage = 'New Ingress resources have been created.';
      }
      
      // 解析Helm输出以获取修订版本和部署时间
      let revision = '';
      let lastDeployed = '';
      let status = '';
      
      if (deployResult.message) {
        // 尝试从Helm输出中提取修订版本
        const revisionMatch = deployResult.message.match(/REVISION:\s+(\d+)/);
        if (revisionMatch && revisionMatch[1]) {
          revision = revisionMatch[1];
        }
        
        // 尝试从Helm输出中提取部署时间
        const deployedMatch = deployResult.message.match(/LAST DEPLOYED:\s+([^\n]+)/);
        if (deployedMatch && deployedMatch[1]) {
          lastDeployed = deployedMatch[1];
        }
        
        // 尝试从Helm输出中提取状态
        const statusMatch = deployResult.message.match(/STATUS:\s+([^\n]+)/);
        if (statusMatch && statusMatch[1]) {
          status = statusMatch[1];
        }
      }
      
      // 添加修订版本信息到消息中
      if (revision && upgradeOnly) {
        statusMessage += ` (Revision: ${revision})`;
      }
      
      // 获取永久存储的Helm图表路径
      const helmChartLocation = deployResult.permanentChartDir || path.join(process.cwd(), 'helm-charts', chartName);
      console.log(`Helm chart is permanently stored at: ${helmChartLocation}`);
      
      res.json({
        success: true,
        message: `${statusMessage} ${ingressMessage}`,
        details: {
          releaseName,
          namespace,
          chartName,
          imageTag: originalImageTag,
          actualImageTag: actualImageTag,
          deploymentType: isUpgradeOperation ? 'upgrade' : 'install',
          ingressStatus,
          actionPerformed: isUpgradeOperation ? 'Upgrade' : 'Install',
          completionTime: new Date().toISOString(),
          revision: revision || 'unknown',
          lastDeployed: lastDeployed || new Date().toISOString(),
          status: status || 'unknown',
          helmOutput: deployResult.message && deployResult.message.substring(0, 500), // 限制输出长度
          isUpgrade: isUpgradeOperation,
          wasRetried: deployResult.retried || false,
          podsRestarted: deployResult.podsRestarted || false,
          helmChartLocation: helmChartLocation // 添加Helm图表位置信息
        },
        upgradePerformed: isUpgradeOperation,
        upgradeInfo: isUpgradeOperation ? {
          previousRevision: parseInt(revision) - 1,
          currentRevision: revision,
          upgradeTime: lastDeployed
        } : null,
        notificationType: isUpgradeOperation ? 'upgrade' : 'deployment',
        notificationTitle: isUpgradeOperation ? 
          `${chartName} has been upgraded to revision ${revision}` : 
          `${chartName} has been deployed successfully`,
        helmChartLocation: helmChartLocation // 添加Helm图表位置信息到顶层
      });
    } catch (error) {
      console.error(`Error deploying Helm chart: ${error.message}`);
      
      // 如果错误对象中有isUpgrade标志，使用它
      if (error.isUpgrade !== undefined) {
        upgradeOnly = error.isUpgrade;
      }
      
      // 提供更详细的错误消息
      let errorMessage = 'Failed to deploy Helm chart';
      let errorDetails = error.message;
      let errorIcon = '❌';
      let errorAction = upgradeOnly ? 'UPGRADE' : 'DEPLOYMENT';
      
      // 检查是否是网络错误
      if (error.code === 'NETWORK_ERROR' || 
          error.message.includes('unexpected EOF') || 
          error.message.includes('connection refused') || 
          error.message.includes('i/o timeout')) {
        errorMessage = `${errorIcon} ${errorAction} FAILED: Network connection error`;
        errorDetails = 'The operation failed due to network connectivity issues. Please check your connection to the Kubernetes cluster and try again.';
      }
      // 检查是否是Ingress冲突
      else if (error.code === 'INGRESS_CONFLICT') {
        errorMessage = `${errorIcon} ${errorAction} FAILED: Ingress resource conflict`;
        errorDetails = `An Ingress with host "${error.details.host}" and path "${error.details.path}" already exists in namespace "${error.details.namespace}". Enable the "Force Upgrade" option to preserve existing Ingress resources.`;
      } else {
        errorMessage = `${errorIcon} ${errorAction} FAILED: ${errorMessage}`;
      }
      
      return res.status(500).json({
        success: false,
        error: errorMessage,
        details: errorDetails,
        timestamp: new Date().toISOString(),
        operation: upgradeOnly ? 'Upgrade' : 'Install',
        operationFailed: true,
        isUpgrade: upgradeOnly,
        chartName,
        namespace,
        releaseName,
        failureReason: error.code || 'UNKNOWN_ERROR',
        suggestions: [
          upgradeOnly ? 'Try again with a stable network connection' : 'Check your network connection',
          'Verify that your Kubernetes cluster is accessible',
          'Check the logs for more detailed error information'
        ]
      });
    }
  } catch (error) {
    console.error(`Error processing request: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: 'Request processing error',
      details: `An error occurred while processing your deployment request: ${error.message}`,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Check that your GitHub URL is correct',
        'Ensure the repository has a valid Helm chart structure',
        'Verify that container images are available in the registry'
      ]
    });
  }
});

// 清理正在进行中的Helm操作
router.post('/cleanup-helm-operations', async (req, res) => {
  try {
    const { namespace, releaseName } = req.body;
    
    if (!namespace) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: namespace'
      });
    }
    
    if (!releaseName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: releaseName'
      });
    }
    
    console.log(`Attempting to clean up in-progress operations for release ${releaseName} in namespace ${namespace}`);
    
    // 尝试清理正在进行中的操作
    const cleanupResult = await helm.checkAndCleanHelmOperations(releaseName, namespace);
    
    if (cleanupResult) {
      return res.json({
        success: true,
        message: `Successfully cleaned up in-progress operations for release ${releaseName} in namespace ${namespace}`
      });
    } else {
      return res.status(500).json({
        success: false,
        error: `Failed to clean up in-progress operations for release ${releaseName} in namespace ${namespace}`,
        message: 'You may need to manually delete the release using kubectl or helm CLI'
      });
    }
  } catch (error) {
    console.error(`Error cleaning up Helm operations: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: 'Error cleaning up Helm operations',
      details: error.message,
      suggestions: [
        'Try using helm CLI directly: helm uninstall <release-name> -n <namespace>',
        'Check if there are any stuck resources using kubectl',
        'Restart the Kubernetes API server if possible'
      ]
    });
  }
});

module.exports = router;
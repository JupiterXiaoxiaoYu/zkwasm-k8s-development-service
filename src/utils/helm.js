const shell = require('shelljs');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const os = require('os');

// Path to the generate-helm.sh script
const GENERATE_HELM_SCRIPT = process.env.GENERATE_HELM_SCRIPT_PATH || path.join(__dirname, '../scripts/generate-helm.sh');

// Generate Helm chart using the generate-helm.sh script
const generateHelmChart = (envVars) => {
  try {
    // 验证必要的环境变量
    if (!envVars.CHART_NAME) {
      throw new Error('CHART_NAME is required');
    }

    console.log(`Generating Helm chart for ${envVars.CHART_NAME}`);
    console.log(`Using generate-helm.sh script at: ${GENERATE_HELM_SCRIPT}`);
    
    // 检查脚本是否存在
    if (!fs.existsSync(GENERATE_HELM_SCRIPT)) {
      throw new Error(`generate-helm.sh script not found at ${GENERATE_HELM_SCRIPT}`);
    }
    
    // 创建临时目录用于 Helm chart
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-'));
    console.log(`Created temporary directory: ${tempDir}`);
    
    // 创建临时脚本来设置环境变量并运行 generate-helm.sh 脚本
    const tempScriptPath = path.join(tempDir, 'run-generate-helm.sh');
    
    // 构建脚本内容，包含环境变量
    let scriptContent = '#!/bin/bash\n\n';
    
    // 添加环境变量
    Object.entries(envVars).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        // 转义值中的特殊字符
        const escapedValue = String(value).replace(/'/g, "'\\''");
        scriptContent += `export ${key}='${escapedValue}'\n`;
        
        // 打印关键环境变量的值
        if (key === 'CHART_NAME' || key === 'GITHUB_OWNER') {
          console.log(`Setting ${key}='${escapedValue}'`);
        } else if (key === 'SANITY_TOKEN' || key === 'SERVER_ADMIN_KEY') {
          // 只打印特定的自定义环境变量
          console.log(`Setting user-specified environment variable ${key}='${escapedValue}'`);
        } else if (!key.startsWith('_') && !key.startsWith('PATH') && !key.startsWith('HOME') && 
                  !key.startsWith('SHELL') && !key.startsWith('TERM') && !key.startsWith('USER') && 
                  !key.startsWith('LANG') && !key.startsWith('PWD') && !key.startsWith('SHLVL') && 
                  !key.startsWith('HOSTNAME')) {
          // 打印其他自定义环境变量
          console.log(`Setting custom environment variable ${key}='${escapedValue}'`);
        }
      }
    });
    
    // 添加运行 generate-helm.sh 脚本的命令
    scriptContent += `\n# Run the generate-helm.sh script\nbash "${path.resolve(GENERATE_HELM_SCRIPT)}"\n`;
    
    // 将脚本写入临时文件
    fs.writeFileSync(tempScriptPath, scriptContent);
    fs.chmodSync(tempScriptPath, '755'); // 使其可执行
    console.log(`Created temporary script: ${tempScriptPath}`);
    
    // 运行脚本
    console.log(`Executing script in directory: ${tempDir}`);
    const result = shell.exec(tempScriptPath, { cwd: tempDir });
    
    if (result.code !== 0) {
      console.error(`Script execution failed with code ${result.code}`);
      console.error(`Script stderr: ${result.stderr}`);
      console.error(`Script stdout: ${result.stdout}`);
      throw new Error(`Failed to generate Helm chart: ${result.stderr || result.stdout}`);
    }
    
    // 查找生成的 Helm chart 目录
    const chartName = envVars.CHART_NAME;
    const chartPath = path.join(tempDir, 'helm-charts', chartName);
    console.log(`Looking for Helm chart at: ${chartPath}`);
    
    // 列出临时目录内容以进行调试
    console.log(`Temporary directory contents:`);
    if (fs.existsSync(path.join(tempDir, 'helm-charts'))) {
      const helmChartsDir = fs.readdirSync(path.join(tempDir, 'helm-charts'));
      console.log(`helm-charts directory contents: ${helmChartsDir.join(', ')}`);
    } else {
      console.log(`helm-charts directory does not exist in ${tempDir}`);
    }
    
    if (!fs.existsSync(chartPath)) {
      throw new Error(`Helm chart directory not found at ${chartPath}`);
    }
    
    console.log(`Helm chart generated successfully at ${chartPath}`);
    
    // 将生成的Helm图表复制到项目根目录下的helm-charts目录中
    const projectRoot = path.resolve(__dirname, '../../');
    const permanentHelmChartsDir = path.join(projectRoot, 'helm-charts');
    const permanentChartDir = path.join(permanentHelmChartsDir, chartName);
    
    // 确保目标目录存在
    if (!fs.existsSync(permanentHelmChartsDir)) {
      console.log(`Creating permanent helm-charts directory at: ${permanentHelmChartsDir}`);
      fs.mkdirSync(permanentHelmChartsDir, { recursive: true });
    }
    
    // 如果目标目录已存在，先删除它
    if (fs.existsSync(permanentChartDir)) {
      console.log(`Removing existing chart directory at: ${permanentChartDir}`);
      fs.rmSync(permanentChartDir, { recursive: true, force: true });
    }
    
    // 复制整个图表目录
    console.log(`Copying Helm chart from ${chartPath} to ${permanentChartDir}`);
    shell.cp('-r', chartPath, permanentHelmChartsDir);
    
    // 验证复制是否成功
    if (fs.existsSync(permanentChartDir)) {
      console.log(`Successfully copied Helm chart to permanent location: ${permanentChartDir}`);
      
      // 列出复制后的目录内容
      const copiedFiles = fs.readdirSync(permanentChartDir);
      console.log(`Copied chart directory contents: ${copiedFiles.join(', ')}`);
    } else {
      console.warn(`Failed to copy Helm chart to permanent location: ${permanentChartDir}`);
    }
    
    return {
      chartPath,
      tempDir,
      permanentChartDir // 返回永久存储位置
    };
  } catch (error) {
    console.error('Error generating Helm chart:', error);
    throw error;
  }
};

// Deploy Helm chart to Kubernetes
const deployHelmChart = (chartPath, releaseName, namespace, values = {}, upgradeOnly = false, forceUpgrade = false, forceRestart = false) => {
  if (!chartPath) {
    throw new Error('Chart path is required');
  }
  
  if (!releaseName) {
    throw new Error('Release name is required');
  }
  
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  
  try {
    // 检查是否有正在进行中的操作
    if (upgradeOnly || forceUpgrade) {
      console.log(`Checking for in-progress operations before deploying ${releaseName}...`);
      try {
        // 尝试清理正在进行中的操作
        const cleanupResult = checkAndCleanHelmOperations(releaseName, namespace);
        if (cleanupResult) {
          console.log(`Successfully cleaned up any in-progress operations for ${releaseName}`);
        } else {
          console.warn(`Failed to clean up in-progress operations for ${releaseName}, proceeding anyway...`);
        }
      } catch (cleanupError) {
        console.warn(`Error checking for in-progress operations: ${cleanupError.message}, proceeding anyway...`);
      }
    }
    
    // 打印关键环境变量的值
    console.log(`Deploying Helm chart with values:`);
    console.log(`IMAGE_VALUE: "${values.config?.app?.image || ''}"`);
    console.log(`MIGRATE_IMAGE_VALUE: "${values.config?.app?.migrateImageValue || ''}"`);
    
    // 创建临时值文件
    const tempValuesPath = path.join(os.tmpdir(), `${releaseName}-values.yaml`);

    // 添加一个唯一的时间戳，用于Pod注解
    const timestamp = Math.floor(Date.now() / 1000);

    // 确保values.podAnnotations存在
    if (!values.podAnnotations) {
      values.podAnnotations = {};
    }

    // 添加重启注解，强制Kubernetes重新拉取镜像
    values.podAnnotations['kubectl.kubernetes.io/restartedAt'] = new Date(timestamp * 1000).toISOString();
    console.log(`Added restart annotation with timestamp: ${timestamp} to force image pull`);

    // 确保镜像拉取策略设置为Always
    if (!values.image) {
      values.image = {};
    }
    values.image.pullPolicy = 'Always';
    console.log(`Ensuring image.pullPolicy is set to Always`);

    // 不再修改镜像标签，使用原始标签
    if (values.image && values.image.tag) {
      // 记录使用的原始标签，用于日志和调试
      const originalTag = values.image.tag;
      console.log(`Using original image tag: "${originalTag}" without timestamp suffix`);
    }

    // 将修改后的values写入临时文件
    fs.writeFileSync(tempValuesPath, yaml.dump(values));

    // 打印临时值文件的内容，用于调试
    console.log(`临时values.yaml文件内容 (${tempValuesPath}):`);
    console.log(fs.readFileSync(tempValuesPath, 'utf8'));
    
    // 构建helm命令，增加超时时间到5分钟
    let helmCommand;
    
    if (upgradeOnly) {
      // 只执行upgrade操作，不使用--install标志
      helmCommand = `helm upgrade ${releaseName} ${chartPath} --values ${tempValuesPath} --namespace ${namespace} --create-namespace --timeout 5m --atomic`;
      console.log(`Upgrading existing release: ${releaseName} in namespace ${namespace}`);
    } else {
      // 使用upgrade --install组合（默认行为）
      helmCommand = `helm upgrade --install ${releaseName} ${chartPath} --values ${tempValuesPath} --namespace ${namespace} --create-namespace --timeout 5m --atomic`;
      console.log(`Installing/upgrading release: ${releaseName} in namespace ${namespace}`);
    }
    
    // 如果强制升级，添加--force参数
    if (forceUpgrade) {
      helmCommand += ' --force';
      console.log(`Force upgrade enabled for release: ${releaseName}`);
    }
    
    // 如果强制重启，记录需要重启
    let needsRestart = forceRestart;
    
    console.log(`Executing Helm command: ${helmCommand}`);
    
    // 运行 helm upgrade --install 命令
    const result = shell.exec(
      helmCommand,
      { silent: false, timeout: 600000 } // 增加到10分钟超时
    );
    
    // 清理临时值文件
    fs.unlinkSync(tempValuesPath);
    
    if (result.code !== 0) {
      // 检查是否是Ingress冲突错误
      const errorOutput = result.stderr || '';
      
      // 检查是否是网络连接问题或超时问题
      if (errorOutput.includes('unexpected EOF') || 
          errorOutput.includes('connection refused') || 
          errorOutput.includes('i/o timeout') ||
          errorOutput.includes('connection reset by peer') ||
          errorOutput.includes('context deadline exceeded')) {
        
        console.error(`Network connection or timeout error detected: ${errorOutput}`);
        
        // 尝试重试一次
        console.log(`Retrying deployment with increased timeout...`);
        
        // 构建带有更长超时的命令
        let retryNetworkCommand = helmCommand.replace(/--timeout \d+m/, '--timeout 15m');
        
        // 更新时间戳，确保使用新的重启注解
        const retryTimestamp = Math.floor(Date.now() / 1000);
        
        // 更新values中的重启注解
        values.podAnnotations['kubectl.kubernetes.io/restartedAt'] = new Date(retryTimestamp * 1000).toISOString();
        console.log(`Updated restart annotation with new timestamp: ${retryTimestamp} for retry`);
        
        // 重新创建临时值文件，因为之前可能已经删除了
        fs.writeFileSync(tempValuesPath, yaml.dump(values));
        
        console.log(`Retrying with command: ${retryNetworkCommand}`);
        
        // 重试部署
        const retryResult = shell.exec(
          retryNetworkCommand,
          { silent: false, timeout: 900000 } // 15分钟超时
        );
        
        // 再次清理临时值文件
        fs.unlinkSync(tempValuesPath);
        
        if (retryResult.code === 0) {
          console.log(`Retry successful after network issue!`);
          
          // 获取永久存储的Helm图表路径
          const projectRoot = path.resolve(__dirname, '../../');
          const permanentChartDir = path.join(projectRoot, 'helm-charts', path.basename(chartPath));
          
          return {
            success: true,
            message: retryResult.stdout,
            retried: true,
            ingressDisabled: helmCommand.includes('ingress.enabled=false') || false,
            isUpgrade: upgradeOnly || retryResult.stdout.includes('has been upgraded'),
            permanentChartDir: permanentChartDir // 添加永久存储路径
          };
        } else {
          console.error(`Retry failed after network issue: ${retryResult.stderr}`);
          const networkError = new Error(`Network connection error: ${errorOutput}`);
          networkError.code = 'NETWORK_ERROR';
          networkError.originalError = errorOutput;
          networkError.retryAttempted = true;
          networkError.retryOutput = retryResult.stderr;
          networkError.isUpgrade = upgradeOnly || retryResult.stdout.includes('has been upgraded');
          throw networkError;
        }
      }
      
      if (errorOutput.includes('admission webhook') && 
          errorOutput.includes('denied the request') && 
          errorOutput.includes('is already defined in ingress')) {
        
        // 提取冲突的主机和路径信息
        const hostMatch = errorOutput.match(/host "([^"]+)" and path "([^"]+)" is already defined in ingress ([^\/]+)\/([^\s]+)/);
        let conflictInfo = {};
        
        if (hostMatch && hostMatch.length >= 5) {
          conflictInfo = {
            host: hostMatch[1],
            path: hostMatch[2],
            namespace: hostMatch[3],
            ingressName: hostMatch[4]
          };
          
          // 如果启用了强制升级，尝试使用--set参数禁用Ingress创建并重试
          if (forceUpgrade) {
            console.log(`Ingress conflict detected. Retrying with ingress.enabled=false...`);
            
            // 禁用Ingress
            values.ingress = {
              ...(values.ingress || {}),
              enabled: false
            };
            console.log(`Set ingress.enabled=false in values to avoid conflicts with existing Ingress resources`);
            
            // 更新时间戳，确保使用新的重启注解
            const retryTimestamp = Math.floor(Date.now() / 1000);
            values.podAnnotations['kubectl.kubernetes.io/restartedAt'] = new Date(retryTimestamp * 1000).toISOString();
            console.log(`Updated restart annotation with new timestamp: ${retryTimestamp} for Ingress conflict retry`);
            
            // 重新创建临时值文件，因为之前可能已经删除了
            fs.writeFileSync(tempValuesPath, yaml.dump(values));
            
            // 构建新的helm命令
            let retryCommand;
            if (upgradeOnly) {
              retryCommand = `helm upgrade ${releaseName} ${chartPath} --namespace ${namespace} --values ${tempValuesPath} --create-namespace --timeout 5m`;
            } else {
              retryCommand = `helm upgrade --install ${releaseName} ${chartPath} --namespace ${namespace} --create-namespace --values ${tempValuesPath} --timeout 5m`;
            }
            
            if (forceUpgrade) {
              retryCommand += ' --force';
            }
            
            console.log(`Retrying with command: ${retryCommand}`);
            
            // 重试部署
            const retryResult = shell.exec(
              retryCommand,
              { silent: false, timeout: 300000 }
            );
            
            // 再次清理临时值文件
            fs.unlinkSync(tempValuesPath);
            
            if (retryResult.code === 0) {
              console.log(`Retry successful! Deployed without creating new Ingress.`);
              
              // 获取永久存储的Helm图表路径
              const projectRoot = path.resolve(__dirname, '../../');
              const permanentChartDir = path.join(projectRoot, 'helm-charts', path.basename(chartPath));
              
              return {
                success: true,
                message: retryResult.stdout,
                retried: true,
                ingressDisabled: true,
                isUpgrade: upgradeOnly || retryResult.stdout.includes('has been upgraded'),
                permanentChartDir: permanentChartDir // 添加永久存储路径
              };
            } else {
              console.error(`Retry failed: ${retryResult.stderr}`);
            }
          }
        }
        
        // 抛出特定的错误类型
        const error = new Error('Ingress conflict detected');
        error.code = 'INGRESS_CONFLICT';
        error.details = conflictInfo;
        error.originalError = errorOutput;
        throw error;
      }
      
      throw new Error(`Failed to deploy Helm chart: ${result.stderr}`);
    }
    
    // 检查是否是升级操作
    const isUpgradeOperation = upgradeOnly || result.stdout.includes('has been upgraded');
    console.log(`✅ HELM OPERATION SUCCESSFUL: ${isUpgradeOperation ? 'UPGRADE' : 'INSTALL'}`);
    console.log(`Helm output indicates ${isUpgradeOperation ? 'an upgrade was performed' : 'a new installation was performed'}`);
    if (result.stdout.includes('has been upgraded')) {
      console.log(`Detected 'has been upgraded' in Helm output, marking as upgrade operation`);
    }
    
    // 如果需要重启Pod，执行kubectl rollout restart
    if (needsRestart || isUpgradeOperation) {
      try {
        console.log(`Forcing pod restart for deployment in namespace ${namespace} with release ${releaseName}...`);
        
        // 使用kubectl获取与release相关的所有deployment
        const deploymentsResult = shell.exec(
          `kubectl get deployment -n ${namespace} -l app.kubernetes.io/instance=${releaseName} -o name`,
          { silent: true }
        );
        
        if (deploymentsResult.code === 0 && deploymentsResult.stdout.trim()) {
          const deployments = deploymentsResult.stdout.trim().split('\n');
          console.log(`Found ${deployments.length} deployments to restart: ${deployments.join(', ')}`);
          
          // 对每个deployment执行rollout restart
          for (const deployment of deployments) {
            console.log(`Restarting ${deployment}...`);
            const restartResult = shell.exec(
              `kubectl rollout restart ${deployment} -n ${namespace}`,
              { silent: false }
            );
            
            if (restartResult.code === 0) {
              console.log(`Successfully restarted ${deployment}`);
            } else {
              console.warn(`Failed to restart ${deployment}: ${restartResult.stderr}`);
            }
          }
          
          console.log(`All deployments have been restarted`);
        } else {
          console.warn(`No deployments found for release ${releaseName} in namespace ${namespace}`);
        }
      } catch (error) {
        console.error(`Error restarting pods: ${error.message}`);
        // 继续执行，不中断流程
      }
    }
    
    // 获取永久存储的Helm图表路径
    const projectRoot = path.resolve(__dirname, '../../');
    const permanentChartDir = path.join(projectRoot, 'helm-charts', path.basename(chartPath));
    
    // 检查 Pod 状态（同步方式）
    let podImageStatus = { success: true, message: 'Pod status check skipped' };
    try {
      // 等待几秒钟，让 Pod 有时间启动
      console.log(`Waiting 5 seconds for pods to start...`);
      const waitStartTime = Date.now();
      while (Date.now() - waitStartTime < 5000) {
        // 空循环等待
      }
      console.log(`Wait completed, checking pod status...`);
      
      // 获取与 release 相关的所有 Pod
      const podsResult = shell.exec(
        `kubectl get pods -n ${namespace} -l app.kubernetes.io/instance=${releaseName} -o json`,
        { silent: true, timeout: 10000 }
      );
      
      if (podsResult.code !== 0) {
        console.warn(`Failed to get pods for release ${releaseName}: ${podsResult.stderr}`);
        podImageStatus = { success: false, message: `Failed to get pods: ${podsResult.stderr}` };
      } else {
        const pods = JSON.parse(podsResult.stdout);
        if (!pods.items || pods.items.length === 0) {
          console.warn(`No pods found for release ${releaseName} in namespace ${namespace}`);
          podImageStatus = { success: false, message: 'No pods found' };
        } else {
          console.log(`Found ${pods.items.length} pods for release ${releaseName}`);
          
          // 检查每个 Pod 的容器状态
          const podStatuses = pods.items.map(pod => {
            const podName = pod.metadata.name;
            const containerStatuses = pod.status.containerStatuses || [];
            
            // 检查是否有容器报告 ImagePullBackOff 或 ErrImagePull 错误
            const imagePullErrors = containerStatuses.filter(status => 
              status.state.waiting && 
              (status.state.waiting.reason === 'ImagePullBackOff' || 
               status.state.waiting.reason === 'ErrImagePull')
            );
            
            // 检查是否有容器报告已成功拉取镜像
            const imagePullSuccesses = containerStatuses.filter(status => 
              status.state.running || 
              (status.state.waiting && status.state.waiting.reason === 'CrashLoopBackOff')
            );
            
            return {
              podName,
              hasImagePullErrors: imagePullErrors.length > 0,
              hasImagePullSuccesses: imagePullSuccesses.length > 0,
              containerStatuses: containerStatuses.map(status => ({
                name: status.name,
                ready: status.ready,
                state: status.state,
                image: status.image
              }))
            };
          });
          
          // 检查是否有任何 Pod 报告镜像拉取错误
          const podsWithImagePullErrors = podStatuses.filter(status => status.hasImagePullErrors);
          if (podsWithImagePullErrors.length > 0) {
            console.error(`Found ${podsWithImagePullErrors.length} pods with image pull errors`);
            podImageStatus = { 
              success: false, 
              message: 'Image pull errors detected',
              podsWithErrors: podsWithImagePullErrors
            };
          } else {
            // 检查是否有任何 Pod 报告已成功拉取镜像
            const podsWithImagePullSuccesses = podStatuses.filter(status => status.hasImagePullSuccesses);
            if (podsWithImagePullSuccesses.length > 0) {
              console.log(`Found ${podsWithImagePullSuccesses.length} pods with successful image pulls`);
              podImageStatus = { 
                success: true, 
                message: 'Image pull successful',
                podsWithSuccesses: podsWithImagePullSuccesses
              };
            } else {
              console.warn(`No pods reported image pull status for release ${releaseName}`);
              podImageStatus = { 
                success: true, 
                message: 'No image pull status reported',
                podStatuses
              };
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error checking pod image status: ${error.message}`);
      podImageStatus = { success: false, message: `Error checking pod status: ${error.message}` };
    }
    
    console.log(`Pod image status check result: ${podImageStatus.success ? 'SUCCESS' : 'FAILURE'}`);
    console.log(`Pod image status message: ${podImageStatus.message}`);
    
    return {
      success: true,
      message: result.stdout,
      ingressDisabled: helmCommand.includes('ingress.enabled=false') || false,
      isUpgrade: isUpgradeOperation,
      podsRestarted: needsRestart || isUpgradeOperation,
      permanentChartDir: permanentChartDir, // 添加永久存储路径
      podImageStatus: podImageStatus // 添加 Pod 镜像状态信息
    };
  } catch (error) {
    console.error('Error deploying Helm chart:', error);
    throw error;
  }
};

// Delete a Helm release
const deleteHelmRelease = (releaseName, namespace) => {
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  
  try {
    const result = shell.exec(
      `helm uninstall ${releaseName} --namespace ${namespace}`,
      { silent: false }
    );
    
    if (result.code !== 0) {
      throw new Error(`Failed to delete Helm release: ${result.stderr}`);
    }
    
    return {
      success: true,
      message: result.stdout
    };
  } catch (error) {
    console.error('Error deleting Helm release:', error);
    throw error;
  }
};

// List Helm releases
const listHelmReleases = (namespace) => {
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  
  try {
    const result = shell.exec(
      `helm list --namespace ${namespace} -o json`,
      { silent: true }
    );
    
    if (result.code !== 0) {
      throw new Error(`Failed to list Helm releases: ${result.stderr}`);
    }
    
    return JSON.parse(result.stdout);
  } catch (error) {
    console.error('Error listing Helm releases:', error);
    throw error;
  }
};

// Check if a Helm release exists
const checkReleaseExists = (namespace, chartName) => {
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  
  try {
    console.log(`Checking if any release with chart ${chartName} exists in namespace ${namespace}`);
    
    // 获取命名空间中的所有发布
    const result = shell.exec(
      `helm list --namespace ${namespace} -o json --timeout 2m`,
      { silent: true, timeout: 120000 } // 添加2分钟超时
    );
    
    if (result.code !== 0) {
      // 检查是否是网络连接问题
      const errorOutput = result.stderr || '';
      if (errorOutput.includes('unexpected EOF') || 
          errorOutput.includes('connection refused') || 
          errorOutput.includes('i/o timeout') ||
          errorOutput.includes('connection reset by peer')) {
        
        console.warn(`Network connection error when checking releases: ${errorOutput}`);
        console.log(`Retrying with increased timeout...`);
        
        // 重试一次，增加超时时间
        const retryResult = shell.exec(
          `helm list --namespace ${namespace} -o json --timeout 5m`,
          { silent: true, timeout: 300000 } // 5分钟超时
        );
        
        if (retryResult.code === 0) {
          console.log(`Retry successful!`);
          // 继续处理成功的结果
          const releases = JSON.parse(retryResult.stdout);
          return processReleases(releases, chartName, namespace);
        }
      }
      
      console.warn(`Failed to list Helm releases: ${result.stderr}`);
      return { exists: false };
    }
    
    // 解析结果
    const releases = JSON.parse(result.stdout);
    return processReleases(releases, chartName, namespace);
  } catch (error) {
    console.error(`Error checking if release exists: ${error.message}`);
    return { exists: false };
  }
};

// 辅助函数，处理发布列表
function processReleases(releases, chartName, namespace) {
  // 构建基本的release名称（不包含随机后缀）
  const baseReleaseName = `${chartName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${namespace.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 8)}`;
  console.log(`Base release name to check: ${baseReleaseName}`);
  
  // 查找使用相同chart的发布或名称以baseReleaseName开头的发布
  const matchingReleases = releases.filter(release => {
    // 检查chart名称是否匹配
    const chartMatches = release.chart.toLowerCase().includes(chartName.toLowerCase());
    
    // 检查release名称是否以baseReleaseName开头（忽略后缀）
    const nameMatches = release.name.startsWith(baseReleaseName);
    
    return chartMatches || nameMatches;
  });
  
  if (matchingReleases.length > 0) {
    console.log(`Found ${matchingReleases.length} existing releases for chart ${chartName} in namespace ${namespace}`);
    console.log(`Existing releases: ${matchingReleases.map(r => r.name).join(', ')}`);
    
    return {
      exists: true,
      releases: matchingReleases,
      // 返回第一个匹配的release名称，用于升级
      releaseName: matchingReleases[0].name
    };
  }
  
  console.log(`No existing releases found for chart ${chartName} in namespace ${namespace}`);
  return { exists: false };
}

// Get values from an existing Helm release
const getHelmReleaseValues = (releaseName, namespace) => {
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  
  try {
    console.log(`Getting values for release ${releaseName} in namespace ${namespace}`);
    
    // 使用helm get values命令获取现有release的值
    const result = shell.exec(
      `helm get values ${releaseName} --namespace ${namespace} -o json`,
      { silent: true }
    );
    
    if (result.code !== 0) {
      console.warn(`Failed to get values for release ${releaseName}: ${result.stderr}`);
      return {};
    }
    
    // 解析结果
    const values = JSON.parse(result.stdout);
    console.log(`Retrieved values for release ${releaseName}:`, values);
    
    return values;
  } catch (error) {
    console.error(`Error getting values for release ${releaseName}: ${error.message}`);
    return {};
  }
};

// 检查并清理正在进行中的Helm操作
const checkAndCleanHelmOperations = (releaseName, namespace) => {
  if (!namespace) {
    throw new Error('Namespace is required');
  }
  
  try {
    console.log(`Checking for in-progress operations for release ${releaseName} in namespace ${namespace}`);
    
    // 获取release的历史记录
    const historyResult = shell.exec(
      `helm history ${releaseName} --namespace ${namespace} -o json`,
      { silent: true }
    );
    
    if (historyResult.code !== 0) {
      console.warn(`Failed to get history for release ${releaseName}: ${historyResult.stderr}`);
      return false;
    }
    
    // 解析历史记录
    const history = JSON.parse(historyResult.stdout);
    
    // 检查是否有正在进行中的操作
    const pendingOperations = history.filter(item => 
      item.status === 'pending' || 
      item.status === 'pending-install' || 
      item.status === 'pending-upgrade' || 
      item.status === 'pending-rollback'
    );
    
    if (pendingOperations.length > 0) {
      console.log(`Found ${pendingOperations.length} pending operations for release ${releaseName}`);
      
      // 尝试回滚到最后一个成功的版本
      const lastSuccessfulRevision = history
        .filter(item => item.status === 'deployed')
        .sort((a, b) => b.revision - a.revision)[0]?.revision;
      
      if (lastSuccessfulRevision) {
        console.log(`Attempting to rollback to last successful revision: ${lastSuccessfulRevision}`);
        
        const rollbackResult = shell.exec(
          `helm rollback ${releaseName} ${lastSuccessfulRevision} --namespace ${namespace} --wait --timeout 2m`,
          { silent: false }
        );
        
        if (rollbackResult.code === 0) {
          console.log(`Successfully rolled back to revision ${lastSuccessfulRevision}`);
          return true;
        } else {
          console.warn(`Failed to rollback: ${rollbackResult.stderr}`);
        }
      }
      
      // 如果回滚失败或没有成功的版本，尝试使用--cleanup-on-fail标志重新安装
      console.log(`Attempting to uninstall and reinstall release ${releaseName}`);
      
      // 先尝试卸载
      const uninstallResult = shell.exec(
        `helm uninstall ${releaseName} --namespace ${namespace} --wait --timeout 2m`,
        { silent: false }
      );
      
      if (uninstallResult.code === 0) {
        console.log(`Successfully uninstalled release ${releaseName}`);
        return true;
      } else {
        console.warn(`Failed to uninstall: ${uninstallResult.stderr}`);
        
        // 如果卸载失败，尝试使用--force标志
        console.log(`Attempting to force uninstall release ${releaseName}`);
        
        const forceUninstallResult = shell.exec(
          `helm uninstall ${releaseName} --namespace ${namespace} --wait --timeout 2m --no-hooks`,
          { silent: false }
        );
        
        if (forceUninstallResult.code === 0) {
          console.log(`Successfully force uninstalled release ${releaseName}`);
          return true;
        } else {
          console.warn(`Failed to force uninstall: ${forceUninstallResult.stderr}`);
        }
      }
      
      return false;
    }
    
    console.log(`No pending operations found for release ${releaseName}`);
    return true;
  } catch (error) {
    console.error(`Error checking for in-progress operations: ${error.message}`);
    return false;
  }
};

module.exports = {
  generateHelmChart,
  deployHelmChart,
  deleteHelmRelease,
  listHelmReleases,
  checkReleaseExists,
  getHelmReleaseValues,
  checkAndCleanHelmOperations
}; 
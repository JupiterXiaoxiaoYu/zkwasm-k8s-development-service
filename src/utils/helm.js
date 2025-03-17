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
const deployHelmChart = (chartPath, releaseName, namespace, values = {}, upgradeOnly = false) => {
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
    console.log(`Deploying Helm chart for ${releaseName} in namespace ${namespace}`);
    
    // 检查现有的release是否存在
    const existingRelease = checkReleaseExists(namespace, path.basename(chartPath));
    const releaseExists = existingRelease.exists;
    
    if (releaseExists && upgradeOnly) {
      console.log(`找到现有的release: ${existingRelease.releaseName}`);
      
      // 获取现有release的values
      const existingValues = getHelmReleaseValues(existingRelease.releaseName, namespace);
      console.log(`获取到现有release的values`);
      
      // 检查是否有PVC定义
      if (existingValues.persistence || values.persistence) {
        console.log(`检测到PVC配置，确保保留现有PVC设置`);
        
        // 保留现有的persistence配置
        if (existingValues.persistence && !values.persistence) {
          values.persistence = existingValues.persistence;
          console.log(`从现有release复制persistence配置`);
        } else if (existingValues.persistence && values.persistence) {
          // 确保不修改关键的PVC字段
          Object.keys(existingValues.persistence).forEach(key => {
            if (existingValues.persistence[key] && 
                typeof existingValues.persistence[key] === 'object' &&
                existingValues.persistence[key].existingClaim) {
              // 保留现有的PVC声明
              if (!values.persistence[key]) {
                values.persistence[key] = {};
              }
              values.persistence[key].existingClaim = existingValues.persistence[key].existingClaim;
              console.log(`保留现有的PVC声明: ${key}.existingClaim = ${existingValues.persistence[key].existingClaim}`);
            }
          });
        }
      }
      
      // 检查是否有volumeClaimTemplates定义（用于StatefulSet）
      if (existingValues.volumeClaimTemplates || values.volumeClaimTemplates) {
        console.log(`检测到volumeClaimTemplates配置，确保保留现有设置`);
        
        // 保留现有的volumeClaimTemplates配置
        if (existingValues.volumeClaimTemplates && !values.volumeClaimTemplates) {
          values.volumeClaimTemplates = existingValues.volumeClaimTemplates;
          console.log(`从现有release复制volumeClaimTemplates配置`);
        }
      }
      
      // 检查MongoDB特定的PVC配置
      if ((existingValues.mongodb && existingValues.mongodb.persistence) || 
          (values.mongodb && values.mongodb.persistence)) {
        console.log(`检测到MongoDB PVC配置，确保保留现有设置`);
        
        // 保留现有的MongoDB persistence配置
        if (existingValues.mongodb && existingValues.mongodb.persistence) {
          if (!values.mongodb) values.mongodb = {};
          values.mongodb.persistence = existingValues.mongodb.persistence;
          console.log(`从现有release复制MongoDB persistence配置`);
        }
      }
    }
    
    // 创建临时值文件
    const tempValuesPath = path.join(os.tmpdir(), `${releaseName}-values.yaml`);

    // 添加一个唯一的时间戳，用于Pod注解，强制重新拉取镜像
    const timestamp = Math.floor(Date.now() / 1000);
    if (!values.podAnnotations) {
      values.podAnnotations = {};
    }
    values.podAnnotations['kubectl.kubernetes.io/restartedAt'] = new Date(timestamp * 1000).toISOString();
    
    // 确保镜像拉取策略设置为Always
    if (!values.image) {
      values.image = {};
    }
    values.image.pullPolicy = 'Always';
    
    // 将values写入临时文件
    fs.writeFileSync(tempValuesPath, yaml.dump(values));
    console.log(`创建临时values文件: ${tempValuesPath}`);
    
    // 构建基本的helm命令
    let helmCommand;
    
    if (upgradeOnly) {
      // 只执行upgrade操作
      helmCommand = `helm upgrade ${releaseName} ${chartPath} --values ${tempValuesPath} --namespace ${namespace} --create-namespace --timeout 5m`;
      
      // 如果存在现有release，添加--reuse-values参数
      if (releaseExists) {
        helmCommand += ' --reuse-values';
      }
      
      console.log(`Upgrading existing release: ${releaseName} in namespace ${namespace}`);
    } else {
      // 使用upgrade --install组合
      helmCommand = `helm upgrade --install ${releaseName} ${chartPath} --values ${tempValuesPath} --namespace ${namespace} --create-namespace --timeout 5m`;
      
      // 如果存在现有release，添加--reuse-values参数
      if (releaseExists) {
        helmCommand += ' --reuse-values';
      }
      
      console.log(`Installing/upgrading release: ${releaseName} in namespace ${namespace}`);
    }
    
    // 运行helm命令
    const result = shell.exec(
      helmCommand,
      { silent: false, timeout: 300000 } // 5分钟超时
    );
    
    // 清理临时值文件
    fs.unlinkSync(tempValuesPath);
    
    if (result.code !== 0) {
      // 检查是否是PVC不可变错误
      const errorOutput = result.stderr || '';
      
      if (errorOutput.includes('PersistentVolumeClaim') && 
          errorOutput.includes('is invalid: spec: Forbidden: spec is immutable')) {
        
        console.log(`检测到PVC不可变错误，尝试使用--no-hooks参数重试...`);
        
        // 创建一个最小化的values文件，只包含必要的更新
        const minimalValues = {
          image: values.image,
          podAnnotations: values.podAnnotations
        };
        
        // 如果有config.app.image，也包含它
        if (values.config && values.config.app && values.config.app.image) {
          if (!minimalValues.config) minimalValues.config = {};
          if (!minimalValues.config.app) minimalValues.config.app = {};
          minimalValues.config.app.image = values.config.app.image;
        }
        
        // 如果有config.app.migrateImageValue，也包含它
        if (values.config && values.config.app && values.config.app.migrateImageValue) {
          if (!minimalValues.config) minimalValues.config = {};
          if (!minimalValues.config.app) minimalValues.config.app = {};
          minimalValues.config.app.migrateImageValue = values.config.app.migrateImageValue;
        }
        
        const minimalValuesPath = path.join(os.tmpdir(), `${releaseName}-minimal-values.yaml`);
        fs.writeFileSync(minimalValuesPath, yaml.dump(minimalValues));
        
        console.log(`创建最小化values文件，只包含镜像和注解:`);
        console.log(fs.readFileSync(minimalValuesPath, 'utf8'));
        
        // 构建新的命令，使用--no-hooks参数
        let retryCommand = `helm upgrade ${releaseName} ${chartPath} --values ${minimalValuesPath} --namespace ${namespace} --reuse-values --timeout 5m --no-hooks`;
        
        console.log(`使用--no-hooks参数重试: ${retryCommand}`);
        
        // 重试部署
        const retryResult = shell.exec(
          retryCommand,
          { silent: false, timeout: 600000 }
        );
        
        // 清理临时值文件
        fs.unlinkSync(minimalValuesPath);
        
        if (retryResult.code === 0) {
          console.log(`重试成功! 使用--no-hooks参数部署以保留PVC.`);
          
          // 获取永久存储的Helm图表路径
          const projectRoot = path.resolve(__dirname, '../../');
          const permanentChartDir = path.join(projectRoot, 'helm-charts', path.basename(chartPath));
          
          return {
            success: true,
            message: retryResult.stdout,
            retried: true,
            preservedPVC: true,
            isUpgrade: true,
            permanentChartDir: permanentChartDir
          };
        } else {
          console.error(`重试失败: ${retryResult.stderr}`);
          
          // 如果重试失败，尝试分析Helm chart中的PVC定义
          console.log(`分析Helm chart中的PVC定义...`);
          
          // 检查Helm chart中的PVC定义
          const chartPvcPath = path.join(chartPath, 'templates');
          if (fs.existsSync(chartPvcPath)) {
            console.log(`检查${chartPvcPath}目录中的PVC定义...`);
            
            // 列出所有模板文件
            const templateFiles = fs.readdirSync(chartPvcPath);
            const pvcFiles = templateFiles.filter(file => 
              file.includes('pvc') || 
              file.includes('persistentvolumeclaim') || 
              file.includes('statefulset')
            );
            
            if (pvcFiles.length > 0) {
              console.log(`找到可能包含PVC定义的文件: ${pvcFiles.join(', ')}`);
              console.log(`建议: 检查这些文件中的PVC定义，确保它们使用existingClaim或条件渲染`);
            }
          }
          
          throw new Error(`使用--no-hooks参数重试失败: ${retryResult.stderr}`);
        }
      }
      
      throw new Error(`Failed to deploy Helm chart: ${result.stderr}`);
    }
    
    // 检查是否是升级操作
    const isUpgradeOperation = upgradeOnly || result.stdout.includes('has been upgraded');
    console.log(`✅ HELM OPERATION SUCCESSFUL: ${isUpgradeOperation ? 'UPGRADE' : 'INSTALL'}`);
    
    // 获取永久存储的Helm图表路径
    const projectRoot = path.resolve(__dirname, '../../');
    const permanentChartDir = path.join(projectRoot, 'helm-charts', path.basename(chartPath));
    
    return {
      success: true,
      message: result.stdout,
      isUpgrade: isUpgradeOperation,
      permanentChartDir: permanentChartDir
    };
  } catch (error) {
    console.error('Error deploying Helm chart:', error);
    throw error;
  }
};

// 直接使用kubectl更新部署，避免修改PVC
const updateDeploymentsDirectly = (releaseName, namespace, values) => {
  try {
    console.log(`尝试直接使用kubectl更新${namespace}命名空间中的${releaseName}部署...`);
    
    // 获取与release相关的所有deployment
    const deploymentsResult = shell.exec(
      `kubectl get deployment -n ${namespace} -l app.kubernetes.io/instance=${releaseName} -o name`,
      { silent: true }
    );
    
    if (deploymentsResult.code !== 0 || !deploymentsResult.stdout.trim()) {
      console.warn(`未找到与${releaseName}相关的部署，无法直接更新`);
      throw new Error(`未找到与${releaseName}相关的部署`);
    }
    
    const deployments = deploymentsResult.stdout.trim().split('\n');
    console.log(`找到${deployments.length}个需要更新的部署: ${deployments.join(', ')}`);
    
    // 提取镜像信息
    let imageValue = '';
    if (values.image && values.image.repository) {
      imageValue = `${values.image.repository}`;
      if (values.image.tag) {
        imageValue += `:${values.image.tag}`;
      }
    } else if (values.config && values.config.app && values.config.app.image) {
      imageValue = values.config.app.image;
    }
    
    if (!imageValue) {
      console.warn(`未找到有效的镜像信息，将只重启部署`);
    } else {
      console.log(`将使用镜像: ${imageValue}`);
    }
    
    // 更新每个部署
    let updateSuccess = false;
    for (const deployment of deployments) {
      console.log(`更新部署 ${deployment}...`);
      
      // 如果有镜像信息，尝试更新镜像
      if (imageValue) {
        // 获取容器名称
        const containersResult = shell.exec(
          `kubectl get ${deployment} -n ${namespace} -o jsonpath='{.spec.template.spec.containers[*].name}'`,
          { silent: true }
        );
        
        if (containersResult.code === 0 && containersResult.stdout.trim()) {
          const containers = containersResult.stdout.trim().split(' ');
          console.log(`找到容器: ${containers.join(', ')}`);
          
          // 更新第一个容器的镜像
          const setImageResult = shell.exec(
            `kubectl set image ${deployment} -n ${namespace} ${containers[0]}=${imageValue}`,
            { silent: false }
          );
          
          if (setImageResult.code === 0) {
            console.log(`成功更新${deployment}的镜像`);
            updateSuccess = true;
          } else {
            console.warn(`更新${deployment}的镜像失败: ${setImageResult.stderr}`);
          }
        }
      }
      
      // 无论镜像更新是否成功，都重启部署
      const restartResult = shell.exec(
        `kubectl rollout restart ${deployment} -n ${namespace}`,
        { silent: false }
      );
      
      if (restartResult.code === 0) {
        console.log(`成功重启${deployment}`);
        updateSuccess = true;
      } else {
        console.warn(`重启${deployment}失败: ${restartResult.stderr}`);
      }
    }
    
    if (!updateSuccess) {
      throw new Error(`所有部署的更新和重启操作都失败了`);
    }
    
    return {
      success: true,
      message: `已通过kubectl直接更新部署，跳过Helm升级以保留PVC`,
      isUpgrade: true,
      updatedDirectly: true
    };
  } catch (error) {
    console.error(`直接更新部署失败:`, error);
    throw new Error(`直接更新部署失败: ${error.message}`);
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
      `helm list --namespace ${namespace} -o json`,
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
        console.log(`Retrying...`);
        
        // 重试一次，增加超时时间
        const retryResult = shell.exec(
          `helm list --namespace ${namespace} -o json`,
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
        
        // 如果卸载失败，尝试使用--no-hooks标志
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
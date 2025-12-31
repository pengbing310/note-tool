// ========== 修复删除同步问题 ==========

async syncWithGitHub() {
    if (this.config.storageType !== 'github') {
        console.log('非GitHub存储模式，跳过同步');
        return;
    }
    
    if (!this.config.username || !this.config.repo || !this.config.token) {
        console.log('GitHub配置不完整，跳过同步');
        return;
    }
    
    if (this.syncing) {
        console.log('正在同步中，跳过');
        return;
    }
    
    this.syncing = true;
    console.log('开始GitHub同步...');
    
    try {
        // 1. 保存当前的删除标记（如果有）
        const pendingDeletes = { ...this.pendingDelete };
        console.log('当前待处理的删除操作:', pendingDeletes);
        
        // 2. 首先立即上传本地数据到GitHub（确保删除操作优先）
        console.log('步骤1: 立即上传本地数据到GitHub');
        const uploadSuccess = await this.saveToGitHub();
        
        if (!uploadSuccess) {
            console.error('GitHub上传失败，跳过后续同步');
            this.showNotification('数据上传失败', 'error');
            this.syncing = false;
            return;
        }
        
        // 3. 短暂延迟，等待GitHub处理
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 4. 从GitHub获取最新数据
        console.log('步骤2: 从GitHub获取最新数据');
        const remoteData = await this.fetchFromGitHub();
        
        // 5. 如果有远程数据，进行智能合并
        if (remoteData) {
            console.log('步骤3: 合并远程数据');
            await this.smartMergeData(remoteData, pendingDeletes);
        } else {
            console.log('没有远程数据，跳过合并');
        }
        
        // 6. 保存合并后的数据
        this.saveLocalData();
        
        // 7. 再次上传最终数据
        console.log('步骤4: 上传最终数据');
        await this.saveToGitHub();
        
        console.log('GitHub同步成功完成');
        
        // 更新UI
        this.renderFolders();
        if (this.currentFolder) {
            this.renderMemos();
        }
        
        this.updateLastSync();
        this.showNotification('数据同步成功', 'success');
        
    } catch (error) {
        console.error('GitHub同步失败:', error);
        this.showNotification('同步失败: ' + error.message, 'error');
    } finally {
        this.syncing = false;
    }
}

// 新增：智能合并数据（确保删除操作不被覆盖）
async smartMergeData(remoteData, pendingDeletes) {
    console.log('开始智能数据合并...', {
        localFolders: this.folders.length,
        localMemos: this.memos.length,
        remoteFolders: remoteData.folders?.length || 0,
        remoteMemos: remoteData.memos?.length || 0,
        pendingDeletes: pendingDeletes
    });
    
    const remoteFolders = remoteData.folders || [];
    const remoteMemos = remoteData.memos || [];
    const remotePasswords = new Map(remoteData.passwords || []);
    
    // 创建查找表
    const localFolderMap = new Map(this.folders.map(f => [f.id, f]));
    const localMemoMap = new Map(this.memos.map(m => [m.id, m]));
    const remoteFolderMap = new Map(remoteFolders.map(f => [f.id, f]));
    const remoteMemoMap = new Map(remoteMemos.map(m => [m.id, m]));
    
    // === 处理文件夹合并 ===
    const mergedFolders = [...this.folders];
    
    // 首先处理删除：如果本地删除了某个文件夹，远程也应该删除
    if (pendingDeletes.type === 'folder' && pendingDeletes.id) {
        // 从合并列表中移除被删除的文件夹
        const deleteIndex = mergedFolders.findIndex(f => f.id === pendingDeletes.id);
        if (deleteIndex !== -1) {
            console.log('移除被删除的文件夹:', mergedFolders[deleteIndex].name);
            mergedFolders.splice(deleteIndex, 1);
        }
        
        // 同时移除远程数据中的这个文件夹
        const remoteDeleteIndex = remoteFolders.findIndex(f => f.id === pendingDeletes.id);
        if (remoteDeleteIndex !== -1) {
            console.log('忽略远程数据中被删除的文件夹');
        }
    }
    
    // 然后添加或更新其他文件夹
    for (const remoteFolder of remoteFolders) {
        // 跳过被删除的文件夹
        if (pendingDeletes.type === 'folder' && pendingDeletes.id === remoteFolder.id) {
            continue;
        }
        
        const existingIndex = mergedFolders.findIndex(f => f.id === remoteFolder.id);
        
        if (existingIndex === -1) {
            // 新文件夹，添加
            mergedFolders.push(remoteFolder);
            console.log('添加新文件夹:', remoteFolder.name);
        } else {
            // 已存在，选择更新的版本
            const localFolder = mergedFolders[existingIndex];
            const localTime = new Date(localFolder.updatedAt || localFolder.createdAt || 0).getTime();
            const remoteTime = new Date(remoteFolder.updatedAt || remoteFolder.createdAt || 0).getTime();
            
            if (remoteTime > localTime) {
                mergedFolders[existingIndex] = remoteFolder;
                console.log('更新文件夹（远程较新）:', remoteFolder.name);
            }
        }
    }
    
    // === 处理备忘录合并 ===
    const mergedMemos = [...this.memos];
    
    // 首先处理删除：如果本地删除了备忘录，远程也应该删除
    if (pendingDeletes.type === 'memo' && pendingDeletes.id) {
        const deleteIndex = mergedMemos.findIndex(m => m.id === pendingDeletes.id);
        if (deleteIndex !== -1) {
            console.log('移除被删除的备忘录:', mergedMemos[deleteIndex].title);
            mergedMemos.splice(deleteIndex, 1);
        }
        
        // 同时移除远程数据中的这个备忘录
        const remoteDeleteIndex = remoteMemos.findIndex(m => m.id === pendingDeletes.id);
        if (remoteDeleteIndex !== -1) {
            console.log('忽略远程数据中被删除的备忘录');
        }
    }
    
    // 然后添加或更新其他备忘录
    for (const remoteMemo of remoteMemos) {
        // 跳过被删除的备忘录
        if (pendingDeletes.type === 'memo' && pendingDeletes.id === remoteMemo.id) {
            continue;
        }
        
        // 检查文件夹是否还存在
        const folderExists = mergedFolders.some(f => f.id === remoteMemo.folderId);
        if (!folderExists) {
            console.log('跳过不存在的文件夹中的备忘录:', remoteMemo.title);
            continue;
        }
        
        const existingIndex = mergedMemos.findIndex(m => m.id === remoteMemo.id);
        
        if (existingIndex === -1) {
            // 新备忘录，添加
            mergedMemos.push(remoteMemo);
            console.log('添加新备忘录:', remoteMemo.title);
        } else {
            // 已存在，选择更新的版本
            const localMemo = mergedMemos[existingIndex];
            const localTime = new Date(localMemo.updatedAt || localMemo.createdAt || 0).getTime();
            const remoteTime = new Date(remoteMemo.updatedAt || remoteMemo.createdAt || 0).getTime();
            
            if (remoteTime > localTime) {
                mergedMemos[existingIndex] = remoteMemo;
                console.log('更新备忘录（远程较新）:', remoteMemo.title);
            }
        }
    }
    
    // 过滤掉不存在的文件夹中的备忘录
    const validFolderIds = new Set(mergedFolders.map(f => f.id));
    const validMemos = mergedMemos.filter(memo => validFolderIds.has(memo.folderId));
    
    // 更新数据
    this.folders = mergedFolders.sort((a, b) => 
        new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );
    
    this.memos = validMemos.sort((a, b) => 
        new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );
    
    // 合并密码
    this.folderPasswords = new Map();
    
    // 首先添加本地密码
    for (const [folderId, password] of this.folderPasswords) {
        if (validFolderIds.has(folderId)) {
            this.folderPasswords.set(folderId, password);
        }
    }
    
    // 然后添加远程密码（不覆盖本地）
    for (const [folderId, password] of remotePasswords) {
        if (validFolderIds.has(folderId) && !this.folderPasswords.has(folderId)) {
            this.folderPasswords.set(folderId, password);
        }
    }
    
    // 使用更高的版本号
    this.dataVersion = Math.max(this.dataVersion, remoteData.version || 0) + 1;
    
    console.log('智能数据合并完成', {
        finalFolders: this.folders.length,
        finalMemos: this.memos.length,
        finalVersion: this.dataVersion
    });
    
    // 清除待处理的删除标记（已处理完成）
    this.pendingDelete = { type: null, id: null };
}

// 修改保存到GitHub的方法
async saveToGitHub() {
    const { username, repo, token } = this.config;
    const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
    
    console.log('保存数据到GitHub:', apiUrl);
    
    try {
        // 准备数据
        const data = {
            folders: this.folders,
            memos: this.memos,
            passwords: Array.from(this.folderPasswords.entries()),
            version: this.dataVersion + 1,
            lastModified: new Date().toISOString(),
            charset: 'UTF-8',
            deviceId: this.deviceId,
            syncAt: new Date().toISOString(),
            syncCount: (this.dataVersion || 0) + 1,
            // 记录删除标记（用于调试）
            pendingDelete: this.pendingDelete.type ? this.pendingDelete : null
        };
        
        // 先获取当前文件的SHA
        let sha = null;
        
        try {
            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (response.ok) {
                const fileInfo = await response.json();
                sha = fileInfo.sha;
                console.log('获取到文件SHA:', sha?.substring(0, 8));
            }
        } catch (error) {
            console.log('文件不存在，将创建新文件');
        }
        
        // 使用UTF-8安全编码
        const content = this.encodeJSONForStorage(data);
        
        // 提交数据到GitHub
        const commitData = {
            message: `备忘录数据同步 v${data.version} - ${new Date().toLocaleString()} - 设备:${this.deviceId.substring(0, 8)}`,
            content: content,
            ...(sha ? { sha } : {})
        };
        
        const response = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(commitData)
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('数据保存到GitHub成功:', {
                sha: result.content?.sha?.substring(0, 8),
                newVersion: data.version
            });
            
            // 更新本地版本号
            this.dataVersion = data.version;
            
            // 保存到本地存储
            this.saveLocalData();
            
            return true;
        } else {
            const error = await response.json();
            console.error('保存到GitHub失败:', error);
            return false;
        }
    } catch (error) {
        console.error('保存到GitHub失败:', error);
        return false;
    }
}

// 修改删除执行方法，确保立即同步
executeDelete() {
    if (!this.pendingDelete.type || !this.pendingDelete.id) {
        this.hideModal(this.confirmModal);
        return;
    }
    
    // 备份原始数据（用于回滚）
    const originalFolders = [...this.folders];
    const originalMemos = [...this.memos];
    const originalPasswords = new Map(this.folderPasswords);
    
    let deletedItemName = '';
    let deleteSuccess = false;
    
    if (this.pendingDelete.type === 'memo') {
        const memoIndex = this.memos.findIndex(m => m.id === this.pendingDelete.id);
        if (memoIndex !== -1) {
            deletedItemName = this.memos[memoIndex].title;
            this.memos.splice(memoIndex, 1);
            deleteSuccess = true;
            
            if (this.currentMemo && this.currentMemo.id === this.pendingDelete.id) {
                this.showMemoList();
                this.currentMemo = null;
            }
        }
    } else if (this.pendingDelete.type === 'folder') {
        const folderIndex = this.folders.findIndex(f => f.id === this.pendingDelete.id);
        if (folderIndex !== -1) {
            deletedItemName = this.folders[folderIndex].name;
            this.folders.splice(folderIndex, 1);
            
            // 删除文件夹中的所有备忘录
            const originalMemoCount = this.memos.length;
            this.memos = this.memos.filter(memo => memo.folderId !== this.pendingDelete.id);
            const deletedMemoCount = originalMemoCount - this.memos.length;
            
            // 删除文件夹密码
            this.folderPasswords.delete(this.pendingDelete.id);
            deleteSuccess = true;
            
            if (this.currentFolder && this.currentFolder.id === this.pendingDelete.id) {
                this.currentFolder = null;
                this.currentMemo = null;
                this.showMemoList();
                
                if (this.currentFolderName) {
                    this.currentFolderName.textContent = '请选择文件夹';
                }
                
                if (this.newMemoBtn) {
                    this.newMemoBtn.disabled = true;
                }
                
                if (this.deleteFolderBtn) {
                    this.deleteFolderBtn.disabled = true;
                }
            }
            
            console.log(`删除文件夹，同时删除了 ${deletedMemoCount} 个备忘录`);
        }
    }
    
    if (deleteSuccess) {
        // 立即保存到本地
        this.saveLocalData();
        
        // 立即更新UI
        this.renderFolders();
        this.renderMemos();
        
        // 如果是GitHub模式，立即同步
        if (this.config.storageType === 'github') {
            console.log('立即触发GitHub同步');
            
            // 保存当前的删除标记
            const currentDelete = { ...this.pendingDelete };
            
            this.showNotification(`正在删除 "${deletedItemName}"...`, 'info');
            
            // 立即开始同步
            setTimeout(() => {
                this.syncWithGitHub().then(() => {
                    this.showNotification(`"${deletedItemName}" 已删除并同步`, 'success');
                }).catch(error => {
                    console.error('删除同步失败:', error);
                    // 如果同步失败，回滚数据
                    this.folders = originalFolders;
                    this.memos = originalMemos;
                    this.folderPasswords = originalPasswords;
                    this.saveLocalData();
                    this.renderFolders();
                    this.renderMemos();
                    this.showNotification(`删除同步失败: ${error.message}`, 'error');
                });
            }, 100);
        } else {
            this.showNotification(`"${deletedItemName}" 已删除`, 'success');
        }
    } else {
        this.showNotification('删除失败，项目未找到', 'error');
    }
    
    this.pendingDelete = { type: null, id: null };
    this.hideModal(this.confirmModal);
}

// 修改初始加载方法
async loadData() {
    console.log('加载数据...');
    try {
        // 1. 加载本地数据
        await this.loadLocalData();
        
        // 2. 如果是GitHub模式，立即同步
        if (this.config.storageType === 'github') {
            console.log('GitHub模式，开始初始同步...');
            
            // 先检查网络
            if (navigator.onLine) {
                await this.syncWithGitHub();
            } else {
                console.log('网络离线，跳过初始同步');
                this.showNotification('网络离线，使用本地数据', 'warning');
            }
        }
        
        // 3. 渲染UI
        this.renderFolders();
        this.updateLastSync();
        
        console.log('数据加载完成', {
            folders: this.folders.length,
            memos: this.memos.length,
            version: this.dataVersion,
            storageType: this.config.storageType
        });
        
    } catch (error) {
        console.error('加载数据失败:', error);
        this.showNotification('数据加载失败: ' + error.message, 'error');
    }
}

// 新增：强制同步方法
forceSync() {
    if (this.config.storageType !== 'github') {
        this.showNotification('非GitHub存储模式，无法同步', 'warning');
        return;
    }
    
    if (this.syncing) {
        this.showNotification('正在同步中，请稍候...', 'info');
        return;
    }
    
    this.showNotification('开始强制同步...', 'info');
    this.syncWithGitHub();
}
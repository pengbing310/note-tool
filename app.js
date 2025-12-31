class GitHubMemo {
    constructor() {
        console.log('开始初始化 GitHubMemo...');
        
        // 基础数据
        this.folders = [];
        this.memos = [];
        this.currentFolder = null;
        this.currentMemo = null;
        this.folderPasswords = new Map();
        
        // 设备ID
        let deviceId = localStorage.getItem('memoDeviceId');
        if (!deviceId) {
            deviceId = 'device_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('memoDeviceId', deviceId);
        }
        this.deviceId = deviceId;
        console.log('设备ID:', this.deviceId);
        
        // 从加密配置加载
        this.config = this.loadEncryptedConfig();
        
        // 其他初始化
        this.pendingDelete = { type: null, id: null };
        this.syncInterval = null;
        this.autoSyncInterval = null;
        this.lastSyncTime = 0;
        this.syncing = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.dataVersion = 0;
        this.networkStatus = navigator.onLine ? 'online' : 'offline';
        this.debugMode = localStorage.getItem('memoDebugMode') === 'true';
        this.syncQueue = [];
        this.processingQueue = false;
        this.githubApiAvailable = true;
        this.rateLimitExceeded = false;
        this.rateLimitResetTime = 0;
        this.requestCount = 0;
        
        console.log('GitHubMemo 初始化完成');
    }
    
    // ========== UTF-8编码/解码函数（完全解决中文乱码）==========
    
    // UTF-8安全的Base64编码 - 确保中文字符正确处理
    utf8ToBase64(str) {
        try {
            // 方法1: 使用TextEncoder（现代浏览器）
            if (typeof TextEncoder !== 'undefined') {
                const encoder = new TextEncoder();
                const data = encoder.encode(str);
                const base64 = btoa(String.fromCharCode(...data));
                return base64;
            }
            // 方法2: 使用encodeURIComponent（兼容旧浏览器）
            return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, 
                (match, p1) => String.fromCharCode('0x' + p1)));
        } catch (error) {
            console.error('utf8ToBase64 error:', error);
            // 方法3: 直接使用btoa（最后手段）
            return btoa(unescape(encodeURIComponent(str)));
        }
    }
    
    // UTF-8安全的Base64解码 - 确保中文字符正确处理
    base64ToUtf8(base64Str) {
        try {
            // 方法1: 使用TextDecoder（现代浏览器）
            if (typeof TextDecoder !== 'undefined') {
                const binary = atob(base64Str);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                const decoder = new TextDecoder();
                return decoder.decode(bytes);
            }
            // 方法2: 使用decodeURIComponent（兼容旧浏览器）
            return decodeURIComponent(atob(base64Str).split('').map(c => 
                '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        } catch (error) {
            console.error('base64ToUtf8 error:', error);
            // 方法3: 直接使用atob（最后手段）
            return decodeURIComponent(escape(atob(base64Str)));
        }
    }
    
    // 编码JSON对象为Base64（完全UTF-8安全）
    encodeJSONForStorage(obj) {
        try {
            // 确保所有字符串字段都是UTF-8编码
            const processedObj = this.ensureUTF8Encoding(obj);
            const jsonStr = JSON.stringify(processedObj);
            console.log('编码JSON字符串长度:', jsonStr.length);
            
            const base64 = this.utf8ToBase64(jsonStr);
            console.log('Base64编码长度:', base64.length);
            
            return base64;
        } catch (error) {
            console.error('encodeJSONForStorage error:', error);
            return btoa(JSON.stringify(obj));
        }
    }
    
    // 解码Base64为JSON对象（完全UTF-8安全）
    decodeJSONFromStorage(base64Str) {
        try {
            console.log('解码Base64字符串，长度:', base64Str.length);
            
            const jsonStr = this.base64ToUtf8(base64Str);
            console.log('解码后JSON字符串长度:', jsonStr.length);
            
            const obj = JSON.parse(jsonStr);
            
            // 验证数据完整性
            if (!obj || typeof obj !== 'object') {
                throw new Error('解码后的数据不是有效的JSON对象');
            }
            
            console.log('JSON解码成功，版本:', obj.version || '未知');
            return obj;
        } catch (error) {
            console.error('decodeJSONFromStorage error:', error);
            // 尝试兼容解码
            try {
                return JSON.parse(atob(base64Str));
            } catch (e2) {
                console.error('兼容解码也失败:', e2);
                return null;
            }
        }
    }
    
    // 确保对象中的所有字符串都是UTF-8编码
    ensureUTF8Encoding(obj) {
        if (typeof obj === 'string') {
            // 对字符串进行UTF-8编码验证
            return this.normalizeString(obj);
        } else if (Array.isArray(obj)) {
            return obj.map(item => this.ensureUTF8Encoding(item));
        } else if (obj && typeof obj === 'object') {
            const result = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    result[this.normalizeString(key)] = this.ensureUTF8Encoding(obj[key]);
                }
            }
            return result;
        }
        return obj;
    }
    
    // 标准化字符串为UTF-8
    normalizeString(str) {
        if (typeof str !== 'string') return str;
        
        // 尝试多种方法确保UTF-8编码
        try {
            // 方法1: 使用TextDecoder/TextEncoder重新编码
            if (typeof TextEncoder !== 'undefined' && typeof TextDecoder !== 'undefined') {
                const encoder = new TextEncoder();
                const decoder = new TextDecoder();
                const bytes = encoder.encode(str);
                return decoder.decode(bytes);
            }
            
            // 方法2: 使用encodeURIComponent/decodeURIComponent
            return decodeURIComponent(encodeURIComponent(str));
            
        } catch (error) {
            console.warn('字符串标准化失败:', error);
            return str;
        }
    }
    
    // ========== 配置管理 ==========
    
    loadEncryptedConfig() {
        console.log('加载配置...');
        
        const defaultConfig = {
            username: '',
            repo: 'memo-data',
            token: '',
            storageType: 'local',
            configured: false
        };
        
        // 检查URL参数
        const urlParams = new URLSearchParams(window.location.search);
        const configFromUrl = this.getConfigFromUrlParams(urlParams);
        
        if (configFromUrl && configFromUrl.configured) {
            console.log('从URL参数加载配置成功');
            this.clearUrlParams();
            return configFromUrl;
        }
        
        // 从localStorage加载
        const saved = localStorage.getItem('githubMemoConfig');
        if (!saved) {
            console.log('没有找到本地配置');
            return defaultConfig;
        }
        
        try {
            const config = JSON.parse(saved);
            
            if (config.token) {
                try {
                    config.token = this.base64ToUtf8(config.token);
                } catch (e) {
                    console.error('Token解密失败:', e);
                    config.token = '';
                }
            }
            
            config.configured = true;
            console.log('从localStorage加载配置成功');
            return config;
        } catch (error) {
            console.error('配置解析失败:', error);
            return defaultConfig;
        }
    }
    
    getConfigFromUrlParams(urlParams) {
        const encodedConfig = urlParams.get('config');
        if (!encodedConfig) return null;
        
        try {
            // URL解码
            const base64 = decodeURIComponent(encodedConfig);
            console.log('URL配置Base64长度:', base64.length);
            
            // UTF-8安全解码
            const config = this.decodeJSONFromStorage(base64);
            
            if (!config) {
                console.log('配置解析失败');
                return null;
            }
            
            if (!config.username || !config.repo || !config.token) {
                console.log('URL配置缺少必要字段');
                return null;
            }
            
            console.log('从URL参数解析配置成功:', config.username);
            
            // 保存到localStorage
            const configToSave = {
                ...config,
                configuredAt: new Date().toISOString(),
                charset: 'UTF-8'
            };
            
            configToSave.token = this.utf8ToBase64(config.token);
            localStorage.setItem('githubMemoConfig', JSON.stringify(configToSave));
            
            return { ...config, configured: true };
        } catch (error) {
            console.error('URL参数解析失败:', error);
            return null;
        }
    }
    
    clearUrlParams() {
        if (window.history.replaceState) {
            const url = new URL(window.location);
            url.searchParams.delete('config');
            window.history.replaceState({}, '', url);
        }
    }
    
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
            // 1. 保存当前的删除标记
            const pendingDeletes = { ...this.pendingDelete };
            console.log('当前待处理的删除操作:', pendingDeletes);
            
            // 2. 首先上传本地数据到GitHub（确保删除操作先上传）
            console.log('步骤1: 上传本地数据到GitHub（优先处理删除）');
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
            
            // 5. 如果有远程数据，合并时保留本地的删除操作
            if (remoteData) {
                console.log('步骤3: 合并远程数据（保留本地删除）');
                await this.smartMergeData(remoteData, pendingDeletes);
            } else {
                console.log('没有远程数据，跳过合并');
            }
            
            // 6. 保存合并后的数据到本地
            this.saveLocalData();
            
            // 7. 再次上传合并后的数据（确保最终一致性）
            console.log('步骤4: 上传最终数据到GitHub');
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
    
    // 智能合并数据（确保删除操作不被覆盖）
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
            
            // 同时忽略远程数据中的这个文件夹
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
            
            // 同时忽略远程数据中的这个备忘录
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
        const mergedPasswords = new Map();
        
        // 首先添加本地密码
        for (const [folderId, password] of this.folderPasswords) {
            if (validFolderIds.has(folderId)) {
                mergedPasswords.set(folderId, password);
            }
        }
        
        // 然后添加远程密码（不覆盖本地）
        for (const [folderId, password] of remotePasswords) {
            if (validFolderIds.has(folderId) && !mergedPasswords.has(folderId)) {
                mergedPasswords.set(folderId, password);
            }
        }
        
        this.folderPasswords = mergedPasswords;
        
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
    
    // 修改保存到GitHub的方法，确保版本号递增
    async saveToGitHub() {
        const { username, repo, token } = this.config;
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        console.log('保存数据到GitHub:', apiUrl);
        
        try {
            // 准备数据 - 确保使用UTF-8编码
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
            
            // 先获取当前文件的SHA（如果存在）
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
    
    // 从GitHub获取数据
    async fetchFromGitHub() {
        const { username, repo, token } = this.config;
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        console.log('从GitHub获取数据:', apiUrl);
        
        try {
            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (response.ok) {
                const fileInfo = await response.json();
                
                if (fileInfo.content) {
                    const base64Str = fileInfo.content.replace(/\n/g, '');
                    const data = this.decodeJSONFromStorage(base64Str);
                    
                    if (data) {
                        console.log('从GitHub获取数据成功', {
                            version: data.version || 0,
                            folders: data.folders?.length || 0,
                            memos: data.memos?.length || 0
                        });
                        
                        return data;
                    }
                }
            } else if (response.status === 404) {
                console.log('GitHub上还没有数据文件');
                return null;
            } else {
                console.error('获取数据失败:', response.status, response.statusText);
                return null;
            }
        } catch (error) {
            console.error('获取GitHub数据失败:', error);
            return null;
        }
    }
    
    // ========== 应用初始化 ==========
    
    init() {
        console.log('初始化应用...配置状态:', this.config.configured);
        
        if (!this.config.configured) {
            console.log('未配置，跳转到配置页面');
            setTimeout(() => {
                if (!window.location.href.includes('config.html')) {
                    window.location.href = 'config.html';
                }
            }, 100);
            return;
        }
        
        this.initElements();
        this.bindEvents();
        this.loadData();
        
        // 监听网络状态
        window.addEventListener('online', () => {
            this.networkStatus = 'online';
            this.showNotification('网络已连接', 'success');
            
            // 如果是GitHub模式，网络恢复时同步
            if (this.config.storageType === 'github') {
                setTimeout(() => this.syncWithGitHub(), 2000);
            }
        });
        
        window.addEventListener('offline', () => {
            this.networkStatus = 'offline';
            this.showNotification('网络已断开', 'warning');
        });
        
        // 如果是GitHub模式，启动同步
        if (this.config.storageType === 'github') {
            this.startAutoSync();
            
            // 页面显示时同步
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && this.networkStatus === 'online') {
                    this.syncWithGitHub();
                }
            });
        }
        
        console.log('应用初始化完成');
    }
    
    // ========== UI相关方法 ==========
    
    initElements() {
        console.log('初始化元素...');
        
        // 获取所有需要的元素
        this.foldersList = document.getElementById('foldersList');
        this.newFolderBtn = document.getElementById('newFolderBtn');
        this.currentFolderName = document.getElementById('currentFolderName');
        this.deleteFolderBtn = document.getElementById('deleteFolderBtn');
        this.memoGrid = document.getElementById('memoGrid');
        this.newMemoBtn = document.getElementById('newMemoBtn');
        this.memoListView = document.getElementById('memoListView');
        this.editorView = document.getElementById('editorView');
        this.memoTitle = document.getElementById('memoTitle');
        this.memoContent = document.getElementById('memoContent');
        this.saveMemoBtn = document.getElementById('saveMemoBtn');
        this.closeEditorBtn = document.getElementById('closeEditorBtn');
        this.deleteMemoBtn = document.getElementById('deleteMemoBtn');
        this.exportMemoBtn = document.getElementById('exportMemoBtn');
        this.charCount = document.getElementById('charCount');
        this.lastModified = document.getElementById('lastModified');
        this.exportAllBtn = document.getElementById('exportAllBtn');
        this.lastSync = document.getElementById('lastSync');
        this.storageMode = document.getElementById('storageMode');
        this.shareConfigBtn = document.getElementById('shareConfigBtn');
        
        // 模态框元素
        this.modalOverlay = document.getElementById('modalOverlay');
        this.newFolderModal = document.getElementById('newFolderModal');
        this.passwordModal = document.getElementById('passwordModal');
        this.confirmModal = document.getElementById('confirmModal');
        
        if (this.newFolderModal) {
            this.folderNameInput = document.getElementById('folderName');
            this.visibilityRadios = this.newFolderModal.querySelectorAll('input[name="visibility"]');
            this.passwordGroup = document.getElementById('passwordGroup');
            this.folderPasswordInput = document.getElementById('folderPassword');
            this.createFolderBtn = document.getElementById('createFolderBtn');
            this.cancelFolderBtn = document.getElementById('cancelFolderBtn');
        }
        
        if (this.passwordModal) {
            this.inputPassword = document.getElementById('inputPassword');
            this.submitPasswordBtn = document.getElementById('submitPasswordBtn');
            this.cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
        }
        
        if (this.confirmModal) {
            this.confirmMessage = document.getElementById('confirmMessage');
            this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
            this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        }
        
        // 更新存储模式显示
        if (this.storageMode) {
            this.storageMode.textContent = this.config.storageType === 'github' ? 'GitHub' : '本地';
        }
        
        console.log('元素初始化完成');
    }
    
    bindEvents() {
        console.log('绑定事件...');
        
        // 文件夹事件
        if (this.newFolderBtn) {
            this.newFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.showNewFolderModal();
            });
        }
        
        if (this.deleteFolderBtn) {
            this.deleteFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.promptDeleteFolder();
            });
        }
        
        // 备忘录事件
        if (this.newMemoBtn) {
            this.newMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.createMemo();
            });
        }
        
        if (this.saveMemoBtn) {
            this.saveMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.saveMemo();
            });
        }
        
        if (this.closeEditorBtn) {
            this.closeEditorBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeEditor();
            });
        }
        
        if (this.deleteMemoBtn) {
            this.deleteMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.promptDeleteMemo();
            });
        }
        
        if (this.exportMemoBtn) {
            this.exportMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.exportCurrentMemo();
            });
        }
        
        if (this.exportAllBtn) {
            this.exportAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.exportAllData();
            });
        }
        
        // 分享按钮事件
        if (this.shareConfigBtn) {
            this.shareConfigBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.showShareConfigModal();
            });
        }
        
        // 同步相关事件
        if (this.lastSync) {
            this.lastSync.addEventListener('click', (e) => {
                if (this.config.storageType === 'github') {
                    this.forceSync();
                }
            });
        }
        
        // 强制同步按钮
        const forceSyncBtn = document.getElementById('forceSyncBtn');
        if (forceSyncBtn) {
            forceSyncBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.forceSync();
            });
        }
        
        // 模态框内的事件绑定
        if (this.visibilityRadios) {
            this.visibilityRadios.forEach(radio => {
                radio.addEventListener('change', (e) => {
                    if (this.passwordGroup) {
                        this.passwordGroup.classList.toggle('hidden', e.target.value === 'public');
                    }
                });
            });
        }
        
        if (this.createFolderBtn) {
            this.createFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.createFolder();
            });
        }
        
        if (this.cancelFolderBtn) {
            this.cancelFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.hideModal(this.newFolderModal);
            });
        }
        
        if (this.submitPasswordBtn) {
            this.submitPasswordBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.verifyPassword();
            });
        }
        
        if (this.cancelPasswordBtn) {
            this.cancelPasswordBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.hideModal(this.passwordModal);
            });
        }
        
        if (this.confirmDeleteBtn) {
            this.confirmDeleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.executeDelete();
            });
        }
        
        if (this.cancelDeleteBtn) {
            this.cancelDeleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.hideModal(this.confirmModal);
            });
        }
        
        // 编辑器输入事件
        if (this.memoContent) {
            this.memoContent.addEventListener('input', () => this.updateEditorInfo());
        }
        
        if (this.memoTitle) {
            this.memoTitle.addEventListener('input', () => this.updateEditorInfo());
        }
        
        console.log('事件绑定完成');
    }
    
    // ========== 数据加载和保存 ==========
    
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
    
    async loadLocalData() {
        const saved = localStorage.getItem('memoLocalData');
        console.log('从localStorage加载数据:', saved ? '有数据' : '无数据');
        
        if (saved) {
            try {
                const data = JSON.parse(saved);
                
                // 验证数据完整性
                if (!data || typeof data !== 'object') {
                    throw new Error('本地数据格式错误');
                }
                
                this.folders = Array.isArray(data.folders) ? data.folders : [];
                this.memos = Array.isArray(data.memos) ? data.memos : [];
                
                // 确保密码是有效的Map
                if (Array.isArray(data.passwords)) {
                    this.folderPasswords = new Map(data.passwords);
                } else {
                    this.folderPasswords = new Map();
                }
                
                this.dataVersion = typeof data.version === 'number' ? data.version : 0;
                
                console.log('本地数据加载成功', {
                    folders: this.folders.length,
                    memos: this.memos.length,
                    version: this.dataVersion
                });
                
            } catch (e) {
                console.error('本地数据解析失败:', e);
                this.initializeEmptyData();
                this.saveLocalData();
            }
        } else {
            this.initializeEmptyData();
        }
    }
    
    initializeEmptyData() {
        console.log('初始化空数据');
        this.folders = [];
        this.memos = [];
        this.folderPasswords = new Map();
        this.dataVersion = 0;
        this.lastSyncTime = 0;
    }
    
    saveLocalData() {
        console.log('保存本地数据...');
        const data = {
            folders: this.folders,
            memos: this.memos,
            passwords: Array.from(this.folderPasswords.entries()),
            version: this.dataVersion,
            lastModified: new Date().toISOString(),
            charset: 'UTF-8',
            deviceId: this.deviceId,
            localSaveTime: Date.now()
        };
        
        localStorage.setItem('memoLocalData', JSON.stringify(data));
        console.log('本地数据已保存', {
            version: this.dataVersion,
            folders: this.folders.length,
            memos: this.memos.length
        });
    }
    
    // ========== 文件夹管理 ==========
    
    renderFolders() {
        console.log('渲染文件夹，总数:', this.folders.length);
        if (!this.foldersList) {
            console.error('文件夹列表元素未找到');
            return;
        }
        
        this.foldersList.innerHTML = '';
        
        if (this.folders.length === 0) {
            this.foldersList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <p>暂无文件夹</p>
                    <p class="tip">点击"新建"按钮创建第一个文件夹</p>
                </div>
            `;
            return;
        }
        
        // 按更新时间排序
        const sortedFolders = [...this.folders].sort((a, b) => {
            return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
        });
        
        sortedFolders.forEach(folder => {
            const folderEl = document.createElement('div');
            folderEl.className = 'folder-item';
            if (this.currentFolder?.id === folder.id) {
                folderEl.classList.add('active');
            }
            
            // 显示文件夹信息
            const folderName = this.escapeHtml(folder.name);
            const dateStr = new Date(folder.updatedAt || folder.createdAt).toLocaleDateString();
            
            folderEl.innerHTML = `
                <div class="folder-content">
                    <i class="fas fa-folder folder-icon ${folder.visibility === 'private' ? 'folder-private' : ''}"></i>
                    <span class="folder-name">${folderName}</span>
                </div>
                <div class="folder-meta">
                    ${folder.visibility === 'private' ? '<i class="fas fa-lock" title="密码保护"></i>' : ''}
                    <span class="folder-date">${dateStr}</span>
                </div>
            `;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'folder-delete-btn';
            deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
            deleteBtn.title = '删除文件夹';
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteFolder(folder.id);
            });
            
            folderEl.appendChild(deleteBtn);
            
            folderEl.addEventListener('click', (e) => {
                if (!e.target.closest('.folder-delete-btn')) {
                    this.selectFolder(folder);
                }
            });
            
            this.foldersList.appendChild(folderEl);
        });
    }
    
    showNewFolderModal() {
        console.log('显示新建文件夹模态框');
        if (!this.newFolderModal || !this.folderNameInput) {
            console.error('新建文件夹模态框元素未找到');
            return;
        }
        
        this.folderNameInput.value = '';
        
        if (this.visibilityRadios && this.visibilityRadios.length > 0) {
            this.visibilityRadios[0].checked = true;
        }
        
        if (this.passwordGroup) {
            this.passwordGroup.classList.add('hidden');
        }
        
        if (this.folderPasswordInput) {
            this.folderPasswordInput.value = '';
        }
        
        this.showModal(this.newFolderModal);
        this.folderNameInput.focus();
    }
    
    createFolder() {
        console.log('创建文件夹...');
        if (!this.folderNameInput) return;
        
        const name = this.folderNameInput.value.trim();
        if (!name) {
            this.showNotification('请输入文件夹名称', 'warning');
            return;
        }
        
        const visibility = document.querySelector('input[name="visibility"]:checked');
        if (!visibility) {
            this.showNotification('请选择权限设置', 'warning');
            return;
        }
        
        const visibilityValue = visibility.value;
        const password = visibilityValue === 'private' && this.folderPasswordInput ? 
            this.folderPasswordInput.value : '';
        
        if (visibilityValue === 'private' && password.length < 4) {
            this.showNotification('密码至少需要4位字符', 'warning');
            return;
        }
        
        const now = new Date().toISOString();
        const folder = {
            id: 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: name,
            visibility: visibilityValue,
            createdAt: now,
            updatedAt: now,
            deviceId: this.deviceId
        };
        
        this.folders.unshift(folder);
        
        if (visibilityValue === 'private' && password) {
            this.folderPasswords.set(folder.id, this.utf8ToBase64(password));
        }
        
        this.saveLocalData();
        
        // 如果是GitHub模式，同步到云端
        if (this.config.storageType === 'github') {
            this.syncWithGitHub();
        }
        
        this.renderFolders();
        this.hideModal(this.newFolderModal);
        this.selectFolder(folder);
        
        this.showNotification('文件夹创建成功: ' + name, 'success');
    }
    
    // ========== 备忘录管理 ==========
    
    selectFolder(folder) {
        console.log('选择文件夹:', folder.name);
        
        if (folder.visibility === 'private') {
            const hasAccess = this.folderPasswords.has(folder.id);
            if (!hasAccess) {
                this.currentFolder = folder;
                this.showPasswordModal();
                return;
            }
        }
        
        this.currentFolder = folder;
        this.currentMemo = null;
        
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        
        const folderItems = document.querySelectorAll('.folder-item');
        folderItems.forEach((item, index) => {
            if (this.folders[index] && this.folders[index].id === folder.id) {
                item.classList.add('active');
            }
        });
        
        if (this.currentFolderName) {
            this.currentFolderName.textContent = folder.name;
        }
        
        if (this.newMemoBtn) {
            this.newMemoBtn.disabled = false;
        }
        
        if (this.deleteFolderBtn) {
            this.deleteFolderBtn.disabled = false;
        }
        
        this.showMemoList();
        this.renderMemos();
    }
    
    createMemo() {
        console.log('创建新备忘录...');
        if (!this.currentFolder) {
            this.showNotification('请先选择一个文件夹', 'warning');
            return;
        }
        
        const now = new Date().toISOString();
        this.currentMemo = {
            id: 'memo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            folderId: this.currentFolder.id,
            title: '新备忘录',
            content: '',
            createdAt: now,
            updatedAt: now,
            deviceId: this.deviceId
        };
        
        this.memos.unshift(this.currentMemo);
        this.showEditor();
        this.updateEditor();
        
        setTimeout(() => {
            if (this.memoTitle) {
                this.memoTitle.focus();
                this.memoTitle.select();
            }
        }, 100);
    }
    
    renderMemos() {
        if (!this.memoGrid || !this.currentFolder) {
            console.log('无法渲染备忘录: memoGrid或currentFolder不存在');
            return;
        }
        
        console.log('渲染备忘录，当前文件夹:', this.currentFolder.name);
        
        this.memoGrid.innerHTML = '';
        
        const folderMemos = this.memos
            .filter(memo => memo.folderId === this.currentFolder.id)
            .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
        
        console.log('文件夹中的备忘录数量:', folderMemos.length);
        
        if (folderMemos.length === 0) {
            this.memoGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-sticky-note"></i>
                    <h3>暂无备忘录</h3>
                    <p>点击"新建备忘录"按钮开始记录</p>
                </div>
            `;
            return;
        }
        
        folderMemos.forEach(memo => {
            const memoEl = document.createElement('div');
            memoEl.className = 'memo-card';
            
            // 确保内容正确显示
            const memoTitle = this.escapeHtml(memo.title || '');
            const contentPreview = memo.content ? 
                this.escapeHtml(memo.content.substring(0, 150).replace(/\n/g, ' ') + (memo.content.length > 150 ? '...' : '')) : 
                '暂无内容';
            
            const date = new Date(memo.updatedAt || memo.createdAt);
            const dateStr = date.toLocaleDateString();
            
            memoEl.innerHTML = `
                <div class="memo-header">
                    <h3 title="${memoTitle}">${memoTitle}</h3>
                    <span class="memo-date">${dateStr}</span>
                </div>
                <div class="memo-content">${contentPreview}</div>
                <div class="memo-actions">
                    <button class="memo-action-btn memo-edit-btn" title="编辑">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="memo-action-btn memo-delete-btn" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            
            const editBtn = memoEl.querySelector('.memo-edit-btn');
            editBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.editMemo(memo.id);
            });
            
            const deleteBtn = memoEl.querySelector('.memo-delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.promptDeleteMemo(memo.id);
            });
            
            memoEl.addEventListener('click', (e) => {
                if (!e.target.closest('.memo-actions')) {
                    this.editMemo(memo.id);
                }
            });
            
            this.memoGrid.appendChild(memoEl);
        });
    }
    
    editMemo(memoId) {
        console.log('编辑备忘录:', memoId);
        const memo = this.memos.find(m => m.id === memoId);
        if (!memo) {
            console.error('找不到备忘录:', memoId);
            return;
        }
        
        this.currentMemo = memo;
        this.showEditor();
        this.updateEditor();
        
        setTimeout(() => {
            if (this.memoContent) {
                this.memoContent.focus();
            }
        }, 100);
    }
    
    updateEditor() {
        if (!this.currentMemo || !this.memoTitle || !this.memoContent) {
            console.error('无法更新编辑器: 缺少必要元素');
            return;
        }
        
        this.memoTitle.value = this.currentMemo.title || '';
        this.memoContent.value = this.currentMemo.content || '';
        this.updateEditorInfo();
    }
    
    updateEditorInfo() {
        if (!this.charCount || !this.lastModified) return;
        
        const content = this.memoContent ? this.memoContent.value : '';
        const title = this.memoTitle ? this.memoTitle.value : '';
        const totalChars = content.length + title.length;
        this.charCount.textContent = totalChars;
        
        if (this.currentMemo && this.currentMemo.updatedAt) {
            const date = new Date(this.currentMemo.updatedAt);
            const now = new Date();
            const diffMinutes = Math.floor((now - date) / (1000 * 60));
            
            if (diffMinutes < 1) {
                this.lastModified.textContent = '刚刚';
            } else if (diffMinutes < 60) {
                this.lastModified.textContent = `${diffMinutes}分钟前`;
            } else if (diffMinutes < 1440) {
                const hours = Math.floor(diffMinutes / 60);
                this.lastModified.textContent = `${hours}小时前`;
            } else {
                this.lastModified.textContent = date.toLocaleDateString();
            }
        } else {
            this.lastModified.textContent = '刚刚';
        }
    }
    
    saveMemo() {
        console.log('保存备忘录...');
        if (!this.currentMemo) {
            this.showNotification('没有可保存的备忘录', 'warning');
            return;
        }
        
        const title = this.memoTitle.value.trim();
        const content = this.memoContent.value.trim();
        
        if (!title) {
            this.showNotification('请输入备忘录标题', 'warning');
            this.memoTitle.focus();
            return;
        }
        
        this.currentMemo.title = title;
        this.currentMemo.content = content;
        this.currentMemo.updatedAt = new Date().toISOString();
        
        const memoIndex = this.memos.findIndex(m => m.id === this.currentMemo.id);
        if (memoIndex !== -1) {
            this.memos[memoIndex] = this.currentMemo;
        } else {
            this.memos.unshift(this.currentMemo);
        }
        
        this.saveLocalData();
        
        // 如果是GitHub模式，同步到云端
        if (this.config.storageType === 'github') {
            this.syncWithGitHub();
        } else {
            this.renderMemos();
        }
        
        this.showNotification('备忘录已保存: ' + title, 'success');
    }
    
    // ========== 分享配置 ==========
    
    showShareConfigModal() {
        console.log('显示分享配置模态框');
        
        if (!this.config.username || !this.config.repo || !this.config.token) {
            this.showNotification('请先配置GitHub信息', 'warning');
            return;
        }
        
        const shareConfig = {
            username: this.config.username,
            repo: this.config.repo,
            token: this.config.token,
            storageType: this.config.storageType,
            sharedAt: new Date().toISOString(),
            note: 'GitHub备忘录配置链接',
            version: '2.0',
            charset: 'UTF-8',
            app: 'GitHub Memo'
        };
        
        try {
            const jsonStr = JSON.stringify(shareConfig);
            console.log('分享配置JSON:', jsonStr);
            
            const base64Data = this.utf8ToBase64(jsonStr);
            console.log('分享配置Base64:', base64Data);
            
            const encoded = encodeURIComponent(base64Data);
            const baseUrl = window.location.origin + window.location.pathname;
            const shareLink = `${baseUrl}?config=${encoded}`;
            
            // 显示分享对话框
            this.showShareDialog(shareLink, shareConfig);
            
        } catch (error) {
            console.error('生成分享链接失败:', error);
            this.showNotification('生成分享链接失败: ' + error.message, 'error');
        }
    }
    
    showShareDialog(shareLink, shareConfig) {
        // 创建分享对话框
        const dialog = document.createElement('div');
        dialog.className = 'modal';
        dialog.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <h3><i class="fas fa-share-alt"></i> 分享配置</h3>
                <p>复制以下链接，在其他设备上打开即可自动配置：</p>
                
                <div class="share-link-container" style="margin: 15px 0;">
                    <input type="text" id="shareLinkInput" class="form-control" 
                           value="${this.escapeHtml(shareLink)}" readonly 
                           style="font-family: monospace; font-size: 12px;">
                    <button id="copyShareLinkBtn" class="btn btn-primary" style="margin-top: 10px;">
                        <i class="fas fa-copy"></i> 复制链接
                    </button>
                </div>
                
                <div class="config-info" style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <p><strong><i class="fas fa-info-circle"></i> 包含的配置信息：</strong></p>
                    <ul style="margin: 10px 0 10px 20px;">
                        <li>用户名: ${this.escapeHtml(shareConfig.username)}</li>
                        <li>仓库: ${this.escapeHtml(shareConfig.repo)}</li>
                        <li>存储类型: ${shareConfig.storageType === 'github' ? 'GitHub云端存储' : '本地存储'}</li>
                        <li>字符编码: ${shareConfig.charset}</li>
                    </ul>
                </div>
                
                <div class="share-warning" style="background: #fff3cd; border: 1px solid #ffeaa7; 
                     border-radius: 8px; padding: 12px; margin: 15px 0;">
                    <p style="margin: 0; color: #856404;">
                        <i class="fas fa-exclamation-triangle"></i>
                        <strong>安全提示：</strong> 此链接包含您的GitHub Token，请谨慎分享！
                    </p>
                </div>
                
                <div class="modal-actions">
                    <button id="closeShareDialogBtn" class="btn btn-secondary">关闭</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // 显示遮罩层
        if (this.modalOverlay) {
            this.modalOverlay.classList.remove('hidden');
        }
        dialog.classList.remove('hidden');
        
        // 绑定事件
        const copyBtn = dialog.querySelector('#copyShareLinkBtn');
        const closeBtn = dialog.querySelector('#closeShareDialogBtn');
        const shareInput = dialog.querySelector('#shareLinkInput');
        
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            shareInput.select();
            
            try {
                document.execCommand('copy');
                copyBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
                copyBtn.disabled = true;
                
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i> 复制链接';
                    copyBtn.disabled = false;
                }, 2000);
            } catch (err) {
                // 备用复制方法
                navigator.clipboard.writeText(shareInput.value).then(() => {
                    copyBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
                    copyBtn.disabled = true;
                    
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i class="fas fa-copy"></i> 复制链接';
                        copyBtn.disabled = false;
                    }, 2000);
                }).catch(() => {
                    this.showNotification('复制失败，请手动复制链接', 'error');
                });
            }
        });
        
        closeBtn.addEventListener('click', () => {
            dialog.remove();
            if (this.modalOverlay) {
                this.modalOverlay.classList.add('hidden');
            }
        });
        
        // 点击遮罩层关闭
        if (this.modalOverlay) {
            this.modalOverlay.addEventListener('click', () => {
                dialog.remove();
                this.modalOverlay.classList.add('hidden');
            });
        }
    }
    
    // ========== 辅助方法 ==========
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showModal(modal) {
        if (!modal) return;
        
        modal.classList.remove('hidden');
        
        if (this.modalOverlay) {
            this.modalOverlay.classList.remove('hidden');
        }
    }
    
    hideModal(modal) {
        if (!modal) return;
        
        modal.classList.add('hidden');
        
        if (this.modalOverlay) {
            this.modalOverlay.classList.add('hidden');
        }
    }
    
    updateLastSync() {
        if (!this.lastSync) return;
        
        const now = new Date();
        this.lastSync.textContent = now.toLocaleTimeString();
        this.lastSyncTime = now.getTime();
    }
    
    startAutoSync() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
        }
        
        // 每1分钟自动同步一次
        this.autoSyncInterval = setInterval(() => {
            if (this.config.storageType === 'github' && this.networkStatus === 'online') {
                console.log('自动同步触发...');
                this.syncWithGitHub().catch(console.error);
            }
        }, 1 * 60 * 1000);
        
        console.log('自动同步已启动（每1分钟一次）');
    }
    
    showNotification(message, type = 'info') {
        console.log('通知:', type, message);
        
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : type === 'warning' ? '#ff9800' : '#2196F3'};
            color: white;
            padding: 15px 20px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            max-width: 300px;
            animation: slideIn 0.3s ease;
        `;
        
        const icon = type === 'success' ? 'fa-check-circle' : 
                    type === 'error' ? 'fa-exclamation-circle' : 
                    type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
        
        notification.innerHTML = `
            <i class="fas ${icon}" style="margin-right: 10px;"></i>
            <span>${this.escapeHtml(message)}</span>
        `;
        
        document.body.appendChild(notification);
        
        // 3秒后自动移除
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 3000);
        
        // 添加CSS动画
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    // ========== 其他方法 ==========
    
    showPasswordModal() {
        if (!this.passwordModal || !this.inputPassword) return;
        
        this.inputPassword.value = '';
        this.showModal(this.passwordModal);
        this.inputPassword.focus();
    }
    
    verifyPassword() {
        if (!this.inputPassword || !this.currentFolder) return;
        
        const password = this.inputPassword.value;
        if (!password) {
            this.showNotification('请输入密码', 'warning');
            return;
        }
        
        const storedPassword = this.folderPasswords.get(this.currentFolder.id);
        const enteredPassword = this.utf8ToBase64(password);
        
        if (enteredPassword === storedPassword) {
            this.hideModal(this.passwordModal);
            this.selectFolder(this.currentFolder);
            this.showNotification('密码验证成功', 'success');
        } else {
            this.showNotification('密码错误！', 'error');
            this.inputPassword.value = '';
            this.inputPassword.focus();
        }
    }
    
    showMemoList() {
        if (!this.memoListView || !this.editorView) return;
        
        this.memoListView.classList.remove('hidden');
        this.editorView.classList.add('hidden');
        this.currentMemo = null;
    }
    
    showEditor() {
        if (!this.memoListView || !this.editorView) return;
        
        this.memoListView.classList.add('hidden');
        this.editorView.classList.remove('hidden');
    }
    
    closeEditor() {
        if (this.currentMemo && 
            (this.memoTitle.value.trim() !== this.currentMemo.title || 
             this.memoContent.value.trim() !== this.currentMemo.content)) {
            
            if (confirm('有未保存的更改，确定要关闭吗？')) {
                this.showMemoList();
                this.renderMemos();
            }
        } else {
            this.showMemoList();
            this.renderMemos();
        }
    }
    
    promptDeleteMemo(memoId) {
        const memo = memoId ? this.memos.find(m => m.id === memoId) : this.currentMemo;
        if (!memo) return;
        
        this.pendingDelete = {
            type: 'memo',
            id: memo.id
        };
        
        if (this.confirmMessage) {
            this.confirmMessage.textContent = `确定要删除备忘录"${this.escapeHtml(memo.title)}"吗？`;
        }
        
        this.showModal(this.confirmModal);
    }
    
    promptDeleteFolder(folderId) {
        const folder = folderId ? this.folders.find(f => f.id === folderId) : this.currentFolder;
        if (!folder) return;
        
        const folderMemos = this.memos.filter(memo => memo.folderId === folder.id);
        
        this.pendingDelete = {
            type: 'folder',
            id: folder.id
        };
        
        if (this.confirmMessage) {
            let message = `确定要删除文件夹"${this.escapeHtml(folder.name)}"吗？`;
            if (folderMemos.length > 0) {
                message += `\n包含 ${folderMemos.length} 个备忘录，也将被删除。`;
            }
            this.confirmMessage.textContent = message;
        }
        
        this.showModal(this.confirmModal);
    }
    
    exportCurrentMemo() {
        if (!this.currentMemo) {
            this.showNotification('没有可导出的备忘录', 'warning');
            return;
        }
        
        const exportData = {
            ...this.currentMemo,
            exportDate: new Date().toISOString(),
            app: 'GitHub Memo',
            charset: 'UTF-8'
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
            type: 'application/json;charset=utf-8' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `备忘录_${this.currentMemo.title}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showNotification('备忘录导出成功', 'success');
    }
    
    exportAllData() {
        const exportData = {
            folders: this.folders,
            memos: this.memos,
            passwords: Array.from(this.folderPasswords.entries()),
            exportDate: new Date().toISOString(),
            app: 'GitHub Memo',
            version: this.dataVersion,
            charset: 'UTF-8'
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
            type: 'application/json;charset=utf-8' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `备忘录备份_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showNotification('数据导出成功', 'success');
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
}

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    console.log('页面加载完成，开始初始化应用...');
    try {
        window.app = new GitHubMemo();
        window.app.init();
    } catch (error) {
        console.error('应用初始化失败:', error);
        alert('应用初始化失败: ' + error.message);
    }
});
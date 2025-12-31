class GitHubMemo {
    constructor() {
        console.log('开始初始化 GitHubMemo...');
        
        // 基础数据
        this.folders = [];
        this.memos = [];
        this.currentFolder = null;
        this.currentMemo = null;
        this.folderPasswords = new Map();
        
        // 设备ID和同步标记
        let deviceId = localStorage.getItem('memoDeviceId');
        if (!deviceId) {
            deviceId = 'device_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('memoDeviceId', deviceId);
        }
        this.deviceId = deviceId;
        this.deviceName = `设备${deviceId.substring(7, 12)}`;
        
        // 同步状态跟踪
        this.pendingOperations = {
            deletes: [],
            updates: [],
            creates: []
        };
        
        // 冲突解决标记
        this.conflictResolutions = new Map();
        
        // 从加密配置加载
        this.config = this.loadEncryptedConfig();
        
        // 其他初始化
        this.syncing = false;
        this.syncInterval = null;
        this.autoSyncInterval = null;
        this.lastSyncTime = parseInt(localStorage.getItem('memoLastSyncTime') || '0');
        this.lastSyncChecksum = localStorage.getItem('memoLastSyncChecksum');
        this.retryCount = 0;
        this.maxRetries = 3;
        this.dataVersion = parseInt(localStorage.getItem('memoDataVersion') || '0');
        this.networkStatus = navigator.onLine ? 'online' : 'offline';
        this.syncQueue = [];
        this.processingQueue = false;
        this.syncConflicts = [];
        
        console.log('GitHubMemo 初始化完成', {
            deviceId: this.deviceId,
            deviceName: this.deviceName,
            dataVersion: this.dataVersion,
            lastSyncTime: this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleString() : '从未同步'
        });
    }
    
    // ========== UTF-8编码/解码函数 ==========
    
    utf8ToBase64(str) {
        try {
            if (typeof TextEncoder !== 'undefined') {
                const encoder = new TextEncoder();
                const data = encoder.encode(str);
                const base64 = btoa(String.fromCharCode(...data));
                return base64;
            }
            return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, 
                (match, p1) => String.fromCharCode('0x' + p1)));
        } catch (error) {
            console.error('utf8ToBase64 error:', error);
            return btoa(unescape(encodeURIComponent(str)));
        }
    }
    
    base64ToUtf8(base64Str) {
        try {
            if (typeof TextDecoder !== 'undefined') {
                const binary = atob(base64Str);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                const decoder = new TextDecoder();
                return decoder.decode(bytes);
            }
            return decodeURIComponent(atob(base64Str).split('').map(c => 
                '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        } catch (error) {
            console.error('base64ToUtf8 error:', error);
            return decodeURIComponent(escape(atob(base64Str)));
        }
    }
    
    encodeJSONForStorage(obj) {
        try {
            const jsonStr = JSON.stringify(obj);
            return this.utf8ToBase64(jsonStr);
        } catch (error) {
            console.error('encodeJSONForStorage error:', error);
            return btoa(JSON.stringify(obj));
        }
    }
    
    decodeJSONFromStorage(base64Str) {
        try {
            const jsonStr = this.base64ToUtf8(base64Str);
            return JSON.parse(jsonStr);
        } catch (error) {
            console.error('decodeJSONFromStorage error:', error);
            try {
                return JSON.parse(atob(base64Str));
            } catch (e2) {
                console.error('兼容解码也失败:', e2);
                return null;
            }
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
        
        // 首先检查URL参数
        const urlParams = new URLSearchParams(window.location.search);
        const configFromUrl = this.getConfigFromUrlParams(urlParams);
        
        if (configFromUrl && configFromUrl.configured) {
            console.log('从URL参数加载配置成功');
            this.clearUrlParams();
            return configFromUrl;
        }
        
        // 然后检查本地存储
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
            const base64 = decodeURIComponent(encodedConfig);
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
            
            // 保存到本地存储
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
    
    // ========== 数据校验和计算 ==========
    
    calculateChecksum() {
        // 创建一个简单的校验和来检测数据变化
        const folderChecksum = this.folders
            .map(f => `${f.id}:${f.updatedAt || f.createdAt}:${f.name}`)
            .join('|');
        
        const memoChecksum = this.memos
            .map(m => `${m.id}:${m.updatedAt || m.createdAt}:${m.title}`)
            .join('|');
        
        return `${folderChecksum.length}:${memoChecksum.length}`;
    }
    
    // ========== 待处理操作管理 ==========
    
    addPendingDelete(type, id) {
        const existingIndex = this.pendingOperations.deletes.findIndex(
            op => op.type === type && op.id === id
        );
        
        if (existingIndex === -1) {
            this.pendingOperations.deletes.push({
                type,
                id,
                timestamp: Date.now(),
                deviceId: this.deviceId,
                deviceName: this.deviceName
            });
            console.log('添加待删除操作:', { type, id });
            this.savePendingOperations();
        }
    }
    
    savePendingOperations() {
        localStorage.setItem('memoPendingOperations', JSON.stringify(this.pendingOperations));
    }
    
    loadPendingOperations() {
        const saved = localStorage.getItem('memoPendingOperations');
        if (saved) {
            try {
                this.pendingOperations = JSON.parse(saved);
                console.log('加载待处理操作:', this.pendingOperations.deletes.length);
            } catch (e) {
                console.error('加载待处理操作失败:', e);
                this.pendingOperations = { deletes: [], updates: [], creates: [] };
            }
        }
    }
    
    // ========== GitHub API 交互（修复CORS问题） ==========
    
    async fetchFromGitHub() {
        const { username, repo, token } = this.config;
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        console.log('从GitHub获取数据:', apiUrl);
        
        try {
            // 修复CORS问题的请求头
            const headers = {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                // 移除可能引起CORS问题的headers
                // 'Cache-Control': 'no-cache' // 这个header会引起CORS问题
            };
            
            // 对于GitHub Pages，使用更简单的请求
            const response = await fetch(apiUrl, {
                headers: headers,
                mode: 'cors', // 明确指定CORS模式
                credentials: 'omit' // 不发送credentials
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
                            memos: data.memos?.length || 0,
                            lastModified: data.lastModified
                        });
                        
                        return data;
                    }
                }
            } else if (response.status === 404) {
                console.log('GitHub上还没有数据文件');
                return null;
            } else {
                const errorText = await response.text();
                console.error('获取数据失败:', response.status, response.statusText, errorText);
                throw new Error(`GitHub API错误: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.error('获取GitHub数据失败:', error);
            
            // 如果是CORS错误，尝试使用代理
            if (error.message.includes('CORS') || error.message.includes('跨域')) {
                console.log('检测到CORS错误，尝试使用代理...');
                return await this.fetchFromGitHubWithProxy();
            }
            
            throw error;
        }
    }
    
    // 使用代理解决CORS问题
    async fetchFromGitHubWithProxy() {
        const { username, repo, token } = this.config;
        
        // 使用CORS代理
        const proxyUrl = 'https://corsproxy.io/?';
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        const proxiedUrl = proxyUrl + encodeURIComponent(apiUrl);
        
        console.log('通过代理获取数据:', proxiedUrl);
        
        try {
            const headers = {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            };
            
            const response = await fetch(proxiedUrl, {
                headers: headers
            });
            
            if (response.ok) {
                const fileInfo = await response.json();
                
                if (fileInfo.content) {
                    const base64Str = fileInfo.content.replace(/\n/g, '');
                    const data = this.decodeJSONFromStorage(base64Str);
                    
                    if (data) {
                        console.log('通过代理从GitHub获取数据成功');
                        return data;
                    }
                }
            } else if (response.status === 404) {
                console.log('GitHub上还没有数据文件');
                return null;
            } else {
                throw new Error(`代理请求失败: ${response.status}`);
            }
        } catch (error) {
            console.error('通过代理获取数据失败:', error);
            throw error;
        }
    }
    
    async saveToGitHub() {
        const { username, repo, token } = this.config;
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        console.log('保存数据到GitHub:', apiUrl);
        
        try {
            let sha = null;
            
            // 获取当前文件的SHA
            try {
                // 使用简单的headers避免CORS问题
                const headers = {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                };
                
                const response = await fetch(apiUrl, {
                    headers: headers,
                    mode: 'cors',
                    credentials: 'omit'
                });
                
                if (response.ok) {
                    const fileInfo = await response.json();
                    sha = fileInfo.sha;
                    console.log('获取到文件SHA:', sha?.substring(0, 8));
                }
            } catch (error) {
                console.log('文件不存在或获取SHA失败:', error);
            }
            
            // 准备要保存的数据
            const data = {
                folders: this.folders,
                memos: this.memos,
                passwords: Array.from(this.folderPasswords.entries()),
                version: this.dataVersion,
                lastModified: new Date().toISOString(),
                charset: 'UTF-8',
                deviceId: this.deviceId,
                deviceName: this.deviceName,
                syncAt: new Date().toISOString(),
                syncCount: (this.dataVersion || 0) + 1,
                pendingOperations: this.pendingOperations
            };
            
            // 使用UTF-8安全编码
            const content = this.encodeJSONForStorage(data);
            
            // 提交数据到GitHub
            const commitData = {
                message: `备忘录数据同步 v${data.version} - ${new Date().toLocaleString()} - ${this.deviceName}`,
                content: content,
                ...(sha ? { sha } : {})
            };
            
            console.log('提交数据到GitHub，版本:', data.version);
            
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
                
                // 更新同步状态
                this.lastSyncChecksum = this.calculateChecksum();
                this.lastSyncTime = Date.now();
                localStorage.setItem('memoLastSyncChecksum', this.lastSyncChecksum);
                localStorage.setItem('memoLastSyncTime', this.lastSyncTime.toString());
                
                // 保存到本地存储
                this.saveLocalData();
                
                return true;
            } else {
                const error = await response.json();
                console.error('保存到GitHub失败:', error);
                
                // 如果是CORS错误，尝试使用代理
                if (error.message && (error.message.includes('CORS') || error.message.includes('Access-Control'))) {
                    console.log('检测到CORS错误，尝试使用代理保存...');
                    return await this.saveToGitHubWithProxy(sha, content);
                }
                
                throw new Error(`保存失败: ${error.message || '未知错误'}`);
            }
        } catch (error) {
            console.error('保存到GitHub失败:', error);
            
            // 如果是CORS错误，尝试使用代理
            if (error.message && (error.message.includes('CORS') || error.message.includes('Access-Control'))) {
                console.log('检测到CORS错误，尝试使用代理保存...');
                return await this.saveToGitHubWithProxy();
            }
            
            throw error;
        }
    }
    
    // 使用代理保存到GitHub
    async saveToGitHubWithProxy(sha = null, content = null) {
        const { username, repo, token } = this.config;
        
        // 如果content未提供，准备数据
        if (!content) {
            const data = {
                folders: this.folders,
                memos: this.memos,
                passwords: Array.from(this.folderPasswords.entries()),
                version: this.dataVersion,
                lastModified: new Date().toISOString(),
                charset: 'UTF-8',
                deviceId: this.deviceId,
                deviceName: this.deviceName,
                syncAt: new Date().toISOString(),
                syncCount: (this.dataVersion || 0) + 1,
                pendingOperations: this.pendingOperations
            };
            
            content = this.encodeJSONForStorage(data);
        }
        
        // 使用CORS代理
        const proxyUrl = 'https://corsproxy.io/?';
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        const proxiedUrl = proxyUrl + encodeURIComponent(apiUrl);
        
        console.log('通过代理保存数据到GitHub:', proxiedUrl);
        
        const commitData = {
            message: `备忘录数据同步 v${this.dataVersion} - ${new Date().toLocaleString()} - ${this.deviceName}`,
            content: content,
            ...(sha ? { sha } : {})
        };
        
        try {
            const response = await fetch(proxiedUrl, {
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
                console.log('通过代理保存数据到GitHub成功');
                
                // 更新同步状态
                this.lastSyncChecksum = this.calculateChecksum();
                this.lastSyncTime = Date.now();
                localStorage.setItem('memoLastSyncChecksum', this.lastSyncChecksum);
                localStorage.setItem('memoLastSyncTime', this.lastSyncTime.toString());
                
                // 保存到本地存储
                this.saveLocalData();
                
                return true;
            } else {
                const error = await response.json();
                throw new Error(`代理保存失败: ${error.message || '未知错误'}`);
            }
        } catch (error) {
            console.error('通过代理保存数据失败:', error);
            throw error;
        }
    }
    
    // ========== 增强的智能合并算法 ==========
    
    async enhancedSmartMerge(remoteData) {
        console.log('开始增强智能合并...');
        
        const remoteFolders = remoteData.folders || [];
        const remoteMemos = remoteData.memos || [];
        const remotePasswords = new Map(remoteData.passwords || []);
        const remotePendingOps = remoteData.pendingOperations || { deletes: [], updates: [], creates: [] };
        
        // 合并待删除操作（从远程和其他设备）
        for (const remoteDelete of remotePendingOps.deletes) {
            this.addPendingDelete(remoteDelete.type, remoteDelete.id);
        }
        
        // 创建索引以便快速查找
        const localFolderIndex = new Map(this.folders.map(f => [f.id, f]));
        const localMemoIndex = new Map(this.memos.map(m => [m.id, m]));
        
        const remoteFolderIndex = new Map(remoteFolders.map(f => [f.id, f]));
        const remoteMemoIndex = new Map(remoteMemos.map(m => [m.id, m]));
        
        const mergedFolders = [];
        const mergedMemos = [];
        const mergedPasswords = new Map();
        
        // 1. 处理文件夹
        console.log('处理文件夹合并...');
        
        // 先处理远程文件夹
        for (const remoteFolder of remoteFolders) {
            const localFolder = localFolderIndex.get(remoteFolder.id);
            
            if (!localFolder) {
                // 远程有，本地没有 -> 添加远程文件夹
                mergedFolders.push(remoteFolder);
                console.log('添加远程文件夹:', remoteFolder.name);
            } else {
                // 两边都有 -> 比较时间戳
                const localTime = new Date(localFolder.updatedAt || localFolder.createdAt || 0).getTime();
                const remoteTime = new Date(remoteFolder.updatedAt || remoteFolder.createdAt || 0).getTime();
                
                if (remoteTime > localTime) {
                    // 远程更新
                    mergedFolders.push(remoteFolder);
                    console.log('更新为远程文件夹:', remoteFolder.name);
                } else if (remoteTime < localTime) {
                    // 本地更新
                    mergedFolders.push(localFolder);
                    console.log('保留本地文件夹:', localFolder.name);
                } else {
                    // 时间相同，保留本地
                    mergedFolders.push(localFolder);
                }
            }
        }
        
        // 添加仅本地的文件夹
        for (const localFolder of this.folders) {
            if (!remoteFolderIndex.has(localFolder.id)) {
                mergedFolders.push(localFolder);
                console.log('添加仅本地文件夹:', localFolder.name);
            }
        }
        
        // 2. 处理备忘录
        console.log('处理备忘录合并...');
        
        // 先处理远程备忘录
        for (const remoteMemo of remoteMemos) {
            // 检查文件夹是否存在
            const folderExists = mergedFolders.some(f => f.id === remoteMemo.folderId);
            if (!folderExists) {
                console.log('跳过不存在的文件夹中的备忘录:', remoteMemo.title);
                continue;
            }
            
            const localMemo = localMemoIndex.get(remoteMemo.id);
            
            if (!localMemo) {
                // 远程有，本地没有 -> 添加远程备忘录
                mergedMemos.push(remoteMemo);
                console.log('添加远程备忘录:', remoteMemo.title);
            } else {
                // 两边都有 -> 比较时间戳
                const localTime = new Date(localMemo.updatedAt || localMemo.createdAt || 0).getTime();
                const remoteTime = new Date(remoteMemo.updatedAt || remoteMemo.createdAt || 0).getTime();
                
                if (remoteTime > localTime) {
                    // 远程更新
                    mergedMemos.push(remoteMemo);
                    console.log('更新为远程备忘录:', remoteMemo.title);
                } else if (remoteTime < localTime) {
                    // 本地更新
                    mergedMemos.push(localMemo);
                    console.log('保留本地备忘录:', localMemo.title);
                } else {
                    // 时间相同，保留本地
                    mergedMemos.push(localMemo);
                }
            }
        }
        
        // 添加仅本地的备忘录
        for (const localMemo of this.memos) {
            if (!remoteMemoIndex.has(localMemo.id)) {
                // 检查文件夹是否存在
                const folderExists = mergedFolders.some(f => f.id === localMemo.folderId);
                if (folderExists) {
                    mergedMemos.push(localMemo);
                    console.log('添加仅本地备忘录:', localMemo.title);
                }
            }
        }
        
        // 3. 处理密码
        console.log('处理密码合并...');
        
        // 先添加远程密码
        for (const [folderId, password] of remotePasswords) {
            const folderExists = mergedFolders.some(f => f.id === folderId);
            if (folderExists) {
                mergedPasswords.set(folderId, password);
            }
        }
        
        // 添加本地密码（覆盖远程）
        for (const [folderId, password] of this.folderPasswords) {
            const folderExists = mergedFolders.some(f => f.id === folderId);
            if (folderExists) {
                mergedPasswords.set(folderId, password);
                console.log('设置本地密码:', folderId);
            }
        }
        
        // 4. 处理待删除操作
        console.log('处理待删除操作...', this.pendingOperations.deletes.length);
        const finalFolders = [];
        const finalMemos = [];
        
        // 过滤被删除的文件夹
        for (const folder of mergedFolders) {
            const shouldDelete = this.pendingOperations.deletes.some(
                op => op.type === 'folder' && op.id === folder.id
            );
            
            if (!shouldDelete) {
                finalFolders.push(folder);
            } else {
                console.log('删除文件夹:', folder.name);
            }
        }
        
        // 过滤被删除的备忘录
        for (const memo of mergedMemos) {
            const shouldDelete = this.pendingOperations.deletes.some(
                op => op.type === 'memo' && op.id === memo.id
            );
            
            if (!shouldDelete) {
                finalMemos.push(memo);
            } else {
                console.log('删除备忘录:', memo.title);
            }
        }
        
        // 删除与已删除文件夹关联的备忘录
        const deletedFolderIds = this.pendingOperations.deletes
            .filter(op => op.type === 'folder')
            .map(op => op.id);
        
        const finalFilteredMemos = finalMemos.filter(memo => 
            !deletedFolderIds.includes(memo.folderId)
        );
        
        // 5. 排序和更新数据
        this.folders = finalFolders.sort((a, b) => 
            new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
        );
        
        this.memos = finalFilteredMemos.sort((a, b) => 
            new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
        );
        
        this.folderPasswords = mergedPasswords;
        
        // 6. 清空已处理的删除操作
        const remainingDeletes = this.pendingOperations.deletes.filter(op => {
            const folderDeleted = op.type === 'folder' && deletedFolderIds.includes(op.id);
            const memoDeleted = op.type === 'memo' && finalMemos.some(m => m.id === op.id);
            return !folderDeleted && !memoDeleted;
        });
        
        this.pendingOperations.deletes = remainingDeletes;
        this.savePendingOperations();
        
        // 7. 更新版本号
        const newVersion = Math.max(this.dataVersion, remoteData.version || 0) + 1;
        this.dataVersion = newVersion;
        
        console.log('增强智能合并完成', {
            最终文件夹数: this.folders.length,
            最终备忘录数: this.memos.length,
            最终版本: this.dataVersion,
            剩余待删除操作: this.pendingOperations.deletes.length
        });
        
        // 立即保存到本地
        this.saveLocalData();
    }
    
    // ========== 主同步函数 ==========
    
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
        this.showSyncIndicator(true);
        
        console.log('开始GitHub双向同步...');
        
        try {
            // 0. 加载待处理的操作
            this.loadPendingOperations();
            
            // 1. 计算本地校验和
            const localChecksum = this.calculateChecksum();
            console.log('本地数据校验和:', localChecksum);
            
            // 2. 从GitHub获取最新数据
            console.log('步骤1: 获取最新GitHub数据');
            let remoteData = null;
            try {
                remoteData = await this.fetchFromGitHub();
            } catch (error) {
                console.warn('获取远程数据失败:', error);
                if (this.retryCount < this.maxRetries) {
                    this.retryCount++;
                    console.log(`第${this.retryCount}次重试...`);
                    setTimeout(() => this.syncWithGitHub(), 2000);
                    return;
                } else {
                    this.showNotification('同步失败: 无法获取远程数据', 'error');
                    this.syncing = false;
                    this.showSyncIndicator(false);
                    return;
                }
            }
            
            // 3. 如果有远程数据，检查是否需要合并
            if (remoteData) {
                console.log('远程数据版本:', remoteData.version);
                console.log('本地数据版本:', this.dataVersion);
                
                // 检查是否需要合并
                const remoteIsNewer = remoteData.version > this.dataVersion;
                const localHasChanges = localChecksum !== this.lastSyncChecksum;
                const neverSynced = !this.lastSyncChecksum;
                
                if (remoteIsNewer || localHasChanges || neverSynced) {
                    console.log('需要同步，开始合并数据');
                    
                    // 检查冲突
                    const hasConflicts = this.checkForConflicts(remoteData);
                    
                    if (hasConflicts) {
                        console.log('检测到数据冲突');
                        await this.resolveConflicts(remoteData);
                    } else {
                        // 执行智能合并
                        await this.enhancedSmartMerge(remoteData);
                    }
                } else {
                    console.log('数据已是最新，跳过合并');
                }
            } else {
                console.log('没有远程数据，直接上传本地数据');
            }
            
            // 4. 保存数据到GitHub
            console.log('步骤2: 上传数据到GitHub');
            await this.saveToGitHub();
            
            console.log('GitHub双向同步成功完成');
            
            // 5. 更新UI
            this.renderFolders();
            if (this.currentFolder) {
                this.renderMemos();
            }
            
            this.updateLastSync();
            this.showNotification('数据同步成功', 'success');
            
            this.retryCount = 0;
            
        } catch (error) {
            console.error('GitHub同步失败:', error);
            this.showNotification('同步失败: ' + error.message, 'error');
            
            // 如果同步失败，重试
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`同步失败，第${this.retryCount}次重试...`);
                setTimeout(() => this.syncWithGitHub(), 3000);
            } else {
                this.retryCount = 0;
                this.showNotification('同步失败，请检查网络和配置', 'error');
            }
        } finally {
            this.syncing = false;
            this.showSyncIndicator(false);
        }
    }
    
    checkForConflicts(remoteData) {
        // 检查是否有冲突（同一个ID在两边都被修改过）
        const conflicts = [];
        
        // 检查文件夹冲突
        const localFolderMap = new Map(this.folders.map(f => [f.id, f]));
        const remoteFolderMap = new Map((remoteData.folders || []).map(f => [f.id, f]));
        
        for (const [id, localFolder] of localFolderMap) {
            const remoteFolder = remoteFolderMap.get(id);
            if (remoteFolder) {
                const localTime = new Date(localFolder.updatedAt || localFolder.createdAt).getTime();
                const remoteTime = new Date(remoteFolder.updatedAt || remoteFolder.createdAt).getTime();
                
                // 如果两个版本都被修改过，并且不是同一次修改
                if (Math.abs(localTime - remoteTime) > 1000 && 
                    localFolder.updatedAt !== remoteFolder.updatedAt) {
                    conflicts.push({
                        type: 'folder',
                        id,
                        local: localFolder,
                        remote: remoteFolder
                    });
                }
            }
        }
        
        // 检查备忘录冲突
        const localMemoMap = new Map(this.memos.map(m => [m.id, m]));
        const remoteMemoMap = new Map((remoteData.memos || []).map(m => [m.id, m]));
        
        for (const [id, localMemo] of localMemoMap) {
            const remoteMemo = remoteMemoMap.get(id);
            if (remoteMemo) {
                const localTime = new Date(localMemo.updatedAt || localMemo.createdAt).getTime();
                const remoteTime = new Date(remoteMemo.updatedAt || remoteMemo.createdAt).getTime();
                
                if (Math.abs(localTime - remoteTime) > 1000 && 
                    localMemo.updatedAt !== remoteMemo.updatedAt) {
                    conflicts.push({
                        type: 'memo',
                        id,
                        local: localMemo,
                        remote: remoteMemo
                    });
                }
            }
        }
        
        if (conflicts.length > 0) {
            console.log('发现冲突:', conflicts.length);
            this.syncConflicts = conflicts;
            return true;
        }
        
        return false;
    }
    
    async resolveConflicts(remoteData) {
        console.log('解决数据冲突...');
        
        // 对于每个冲突，选择较新的版本
        for (const conflict of this.syncConflicts) {
            if (conflict.type === 'folder') {
                const localTime = new Date(conflict.local.updatedAt || conflict.local.createdAt).getTime();
                const remoteTime = new Date(conflict.remote.updatedAt || conflict.remote.createdAt).getTime();
                
                if (remoteTime > localTime) {
                    // 使用远程版本
                    const index = this.folders.findIndex(f => f.id === conflict.id);
                    if (index !== -1) {
                        this.folders[index] = conflict.remote;
                        console.log('解决文件夹冲突，使用远程版本:', conflict.remote.name);
                    }
                } else {
                    console.log('解决文件夹冲突，保留本地版本:', conflict.local.name);
                }
            } else if (conflict.type === 'memo') {
                const localTime = new Date(conflict.local.updatedAt || conflict.local.createdAt).getTime();
                const remoteTime = new Date(conflict.remote.updatedAt || conflict.remote.createdAt).getTime();
                
                if (remoteTime > localTime) {
                    // 使用远程版本
                    const index = this.memos.findIndex(m => m.id === conflict.id);
                    if (index !== -1) {
                        this.memos[index] = conflict.remote;
                        console.log('解决备忘录冲突，使用远程版本:', conflict.remote.title);
                    }
                } else {
                    console.log('解决备忘录冲突，保留本地版本:', conflict.local.title);
                }
            }
        }
        
        // 清空冲突列表
        this.syncConflicts = [];
        
        // 继续合并其他数据
        await this.enhancedSmartMerge(remoteData);
    }
    
    startAutoSync() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
        }
        
        // 每60秒检查一次是否需要同步
        this.autoSyncInterval = setInterval(() => {
            if (this.config.storageType === 'github' && 
                this.networkStatus === 'online' && 
                !this.syncing) {
                
                // 检查自上次同步后是否有更改
                const currentChecksum = this.calculateChecksum();
                const timeSinceLastSync = Date.now() - this.lastSyncTime;
                const needsSync = currentChecksum !== this.lastSyncChecksum || 
                                 timeSinceLastSync > 120000; // 2分钟强制同步一次
                
                if (needsSync) {
                    console.log('自动同步触发...');
                    this.syncWithGitHub().catch(console.error);
                }
            }
        }, 60 * 1000);
        
        console.log('自动同步已启动');
    }
    
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
    
    showSyncIndicator(show) {
        let indicator = document.getElementById('syncStatusIndicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'syncStatusIndicator';
            indicator.className = 'sync-status-indicator hidden';
            indicator.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i><span>正在同步...</span>';
            document.body.appendChild(indicator);
        }
        
        if (show) {
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
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
            
            // 如果是GitHub模式，网络恢复时立即同步
            if (this.config.storageType === 'github') {
                setTimeout(() => {
                    if (!this.syncing) {
                        console.log('网络恢复，自动同步');
                        this.syncWithGitHub();
                    }
                }, 2000);
            }
        });
        
        window.addEventListener('offline', () => {
            this.networkStatus = 'offline';
            this.showNotification('网络已断开', 'warning');
        });
        
        // 如果是GitHub模式，启动自动同步
        if (this.config.storageType === 'github') {
            this.startAutoSync();
            
            // 页面获取焦点时同步
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && 
                    this.networkStatus === 'online' && 
                    !this.syncing) {
                    setTimeout(() => this.syncWithGitHub(), 1000);
                }
            });
            
            // 显示同步状态
            this.updateSyncStatusDisplay();
        }
        
        console.log('应用初始化完成');
    }
    
    updateSyncStatusDisplay() {
        if (this.storageMode) {
            this.storageMode.textContent = 'GitHub云端';
            this.storageMode.classList.add('device-info');
            this.storageMode.title = `设备: ${this.deviceName}`;
        }
        
        if (this.lastSync) {
            if (this.lastSyncTime) {
                const timeStr = new Date(this.lastSyncTime).toLocaleTimeString();
                this.lastSync.textContent = timeStr;
                this.lastSync.title = `上次同步: ${new Date(this.lastSyncTime).toLocaleString()}`;
            }
        }
    }
    
    // ========== UI相关方法 ==========
    
    initElements() {
        console.log('初始化元素...');
        
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
        
        console.log('元素初始化完成');
    }
    
    bindEvents() {
        console.log('绑定事件...');
        
        // 绑定事件（与之前相同）
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
        
        if (this.shareConfigBtn) {
            this.shareConfigBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.showShareConfigModal();
            });
        }
        
        if (this.lastSync) {
            this.lastSync.addEventListener('click', (e) => {
                if (this.config.storageType === 'github') {
                    this.forceSync();
                }
            });
        }
        
        const forceSyncBtn = document.getElementById('forceSyncBtn');
        if (forceSyncBtn) {
            forceSyncBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.forceSync();
            });
        }
        
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
        
        if (this.memoContent) {
            this.memoContent.addEventListener('input', () => this.updateEditorInfo());
        }
        
        if (this.memoTitle) {
            this.memoTitle.addEventListener('input', () => this.updateEditorInfo());
        }
        
        console.log('事件绑定完成');
// ========== 移动端优化 ==========

addMobileOptimizations() {
    console.log('添加移动端优化...');
    
    // 检测是否为移动设备
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    console.log('是否为移动设备:', this.isMobile);
    
    if (this.isMobile) {
        // 调整编辑器区域高度
        this.adjustEditorForMobile();
        
        // 添加键盘事件处理
        this.addKeyboardHandling();
        
        // 优化触摸事件
        this.optimizeTouchEvents();
        
        // 添加返回按钮处理
        this.addBackButtonHandler();
    }
}

adjustEditorForMobile() {
    // 在移动设备上，调整编辑器高度
    if (this.memoContent && window.innerHeight < 800) {
        const viewportHeight = window.innerHeight;
        const editorHeight = viewportHeight * 0.6; // 使用60%的屏幕高度
        this.memoContent.style.minHeight = `${editorHeight}px`;
        
        console.log('调整编辑器高度:', editorHeight);
    }
}

addKeyboardHandling() {
    // 处理虚拟键盘弹出
    if (this.memoContent) {
        this.memoContent.addEventListener('focus', () => {
            setTimeout(() => {
                if (this.isMobile) {
                    // 滚动到可见区域
                    this.memoContent.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center' 
                    });
                }
            }, 300);
        });
    }
}

optimizeTouchEvents() {
    // 优化触摸事件，防止双击缩放
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });
    
    // 优化按钮触摸反馈
    const buttons = document.querySelectorAll('.btn, .memo-action-btn, .folder-delete-btn');
    buttons.forEach(button => {
        button.addEventListener('touchstart', () => {
            button.style.transform = 'scale(0.95)';
        });
        
        button.addEventListener('touchend', () => {
            button.style.transform = 'scale(1)';
        });
    });
}

addBackButtonHandler() {
    // 在移动端添加返回按钮处理
    if (this.isMobile) {
        // 监听安卓返回按钮
        window.addEventListener('popstate', (e) => {
            if (this.editorView && !this.editorView.classList.contains('hidden')) {
                // 如果正在编辑，先关闭编辑器
                this.closeEditor();
                e.preventDefault();
            }
        });
    }
}

// ========== 在 init() 方法中调用移动端优化 ==========

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
    
    // 添加移动端优化
    this.addMobileOptimizations();
    
    this.loadData();
    
    // 监听网络状态
    window.addEventListener('online', () => {
        this.networkStatus = 'online';
        this.showNotification('网络已连接', 'success');
        
        // 如果是GitHub模式，网络恢复时立即同步
        if (this.config.storageType === 'github') {
            setTimeout(() => {
                if (!this.syncing) {
                    console.log('网络恢复，自动同步');
                    this.syncWithGitHub();
                }
            }, 2000);
        }
    });
    
    window.addEventListener('offline', () => {
        this.networkStatus = 'offline';
        this.showNotification('网络已断开', 'warning');
    });
    
    // 如果是GitHub模式，启动自动同步
    if (this.config.storageType === 'github') {
        this.startAutoSync();
        
        // 页面获取焦点时同步
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && 
                this.networkStatus === 'online' && 
                !this.syncing) {
                setTimeout(() => this.syncWithGitHub(), 1000);
            }
        });
        
        // 显示同步状态
        this.updateSyncStatusDisplay();
    }
    
    // 监听窗口大小变化，调整移动端布局
    window.addEventListener('resize', () => {
        this.adjustMobileLayout();
    });
    
    console.log('应用初始化完成');
}

adjustMobileLayout() {
    if (this.isMobile) {
        // 重新调整布局
        this.adjustEditorForMobile();
        
        // 更新按钮可见性
        if (window.innerWidth < 480) {
            // 超小屏幕优化
            this.optimizeForVerySmallScreen();
        }
    }
}

optimizeForVerySmallScreen() {
    // 超小屏幕进一步优化
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(button => {
        const originalText = button.textContent;
        const hasIcon = button.querySelector('i');
        
        if (hasIcon && originalText.length > 2) {
            // 只保留图标，隐藏文字
            const span = button.querySelector('span');
            if (span) {
                span.style.display = 'none';
            }
        }
    });
}
    }
    
    // ========== 数据加载和保存 ==========
    
    async loadData() {
        console.log('加载数据...');
        try {
            // 1. 加载本地数据
            await this.loadLocalData();
            
            // 2. 加载待处理操作
            this.loadPendingOperations();
            
            // 3. 更新同步状态显示
            this.updateSyncStatusDisplay();
            
            // 4. 如果是GitHub模式，尝试同步
            if (this.config.storageType === 'github') {
                console.log('GitHub模式，尝试同步...');
                
                // 先检查网络
                if (navigator.onLine) {
                    // 延迟1秒开始同步，确保页面完全加载
                    setTimeout(() => {
                        console.log('网络正常，尝试同步');
                        this.syncWithGitHub().catch(error => {
                            console.warn('初始同步失败，将在后台重试:', error);
                            this.showNotification('同步失败，将在后台重试', 'warning');
                        });
                    }, 1000);
                } else {
                    console.log('网络离线，跳过初始同步');
                    this.showNotification('网络离线，使用本地数据', 'warning');
                    
                    // 检查是否有离线修改
                    if (this.pendingOperations.deletes.length > 0) {
                        console.log('有离线删除操作等待同步');
                        this.showNotification('有离线修改等待同步', 'info');
                    }
                }
            }
            
            // 5. 渲染UI
            this.renderFolders();
            this.updateLastSync();
            
            console.log('数据加载完成', {
                folders: this.folders.length,
                memos: this.memos.length,
                version: this.dataVersion,
                storageType: this.config.storageType,
                deviceName: this.deviceName
            });
            
            // 显示加载完成通知
            setTimeout(() => {
                this.showNotification(`已加载 ${this.folders.length} 个文件夹，${this.memos.length} 个备忘录`, 'info');
            }, 500);
            
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
                
                if (!data || typeof data !== 'object') {
                    throw new Error('本地数据格式错误');
                }
                
                this.folders = Array.isArray(data.folders) ? data.folders : [];
                this.memos = Array.isArray(data.memos) ? data.memos : [];
                
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
            deviceName: this.deviceName,
            localSaveTime: Date.now()
        };
        
        localStorage.setItem('memoLocalData', JSON.stringify(data));
        localStorage.setItem('memoDataVersion', this.dataVersion.toString());
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
        
        const sortedFolders = [...this.folders].sort((a, b) => {
            return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
        });
        
        sortedFolders.forEach(folder => {
            const folderEl = document.createElement('div');
            folderEl.className = 'folder-item';
            if (this.currentFolder?.id === folder.id) {
                folderEl.classList.add('active');
            }
            
            const folderName = this.escapeHtml(folder.name);
            const dateStr = new Date(folder.updatedAt || folder.createdAt).toLocaleDateString();
            const memoCount = this.memos.filter(m => m.folderId === folder.id).length;
            
            folderEl.innerHTML = `
                <div class="folder-content">
                    <i class="fas fa-folder folder-icon ${folder.visibility === 'private' ? 'folder-private' : ''}"></i>
                    <div class="folder-details">
                        <span class="folder-name">${folderName}</span>
                        <span class="folder-count">${memoCount} 个备忘录</span>
                    </div>
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
    
    // 其他UI方法保持不变...
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
            deviceId: this.deviceId,
            deviceName: this.deviceName
        };
        
        this.folders.unshift(folder);
        
        if (visibilityValue === 'private' && password) {
            this.folderPasswords.set(folder.id, this.utf8ToBase64(password));
        }
        
        this.saveLocalData();
        
        // 立即同步到GitHub
        if (this.config.storageType === 'github') {
            console.log('立即同步新增文件夹');
            this.syncWithGitHub();
        }
        
        this.renderFolders();
        this.hideModal(this.newFolderModal);
        this.selectFolder(folder);
        
        this.showNotification('文件夹创建成功: ' + name, 'success');
    }
    
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
            this.currentFolderName.title = `最后更新: ${new Date(folder.updatedAt || folder.createdAt).toLocaleString()}`;
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
            deviceId: this.deviceId,
            deviceName: this.deviceName
        };
        
        this.memos.unshift(this.currentMemo);
        this.showEditor();
        this.updateEditor();
        
        this.saveLocalData();
        
        // 立即同步到GitHub
        if (this.config.storageType === 'github') {
            console.log('立即同步新增备忘录');
            this.syncWithGitHub();
        }
        
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
        
        // 立即同步到GitHub
        if (this.config.storageType === 'github') {
            console.log('立即同步保存备忘录');
            this.syncWithGitHub();
        } else {
            this.renderMemos();
        }
        
        this.showNotification('备忘录已保存: ' + title, 'success');
    }
    
    // ========== 删除操作 ==========
    
    promptDeleteMemo(memoId) {
        const memo = memoId ? this.memos.find(m => m.id === memoId) : this.currentMemo;
        if (!memo) return;
        
        if (this.confirmMessage) {
            this.confirmMessage.textContent = `确定要删除备忘录"${this.escapeHtml(memo.title)}"吗？`;
        }
        
        this.confirmModal.dataset.deleteType = 'memo';
        this.confirmModal.dataset.deleteId = memo.id;
        this.confirmModal.dataset.deleteName = memo.title;
        
        this.showModal(this.confirmModal);
    }
    
    promptDeleteFolder(folderId) {
        const folder = folderId ? this.folders.find(f => f.id === folderId) : this.currentFolder;
        if (!folder) return;
        
        const folderMemos = this.memos.filter(memo => memo.folderId === folder.id);
        
        let message = `确定要删除文件夹"${this.escapeHtml(folder.name)}"吗？`;
        if (folderMemos.length > 0) {
            message += `\n包含 ${folderMemos.length} 个备忘录，也将被删除。`;
        }
        
        if (this.confirmMessage) {
            this.confirmMessage.textContent = message;
        }
        
        this.confirmModal.dataset.deleteType = 'folder';
        this.confirmModal.dataset.deleteId = folder.id;
        this.confirmModal.dataset.deleteName = folder.name;
        
        this.showModal(this.confirmModal);
    }
    
    executeDelete() {
        const deleteType = this.confirmModal.dataset.deleteType;
        const deleteId = this.confirmModal.dataset.deleteId;
        const deleteName = this.confirmModal.dataset.deleteName;
        
        if (!deleteType || !deleteId) {
            this.hideModal(this.confirmModal);
            return;
        }
        
        // 记录删除操作到待处理列表
        this.addPendingDelete(deleteType, deleteId);
        
        // 立即从本地移除
        if (deleteType === 'memo') {
            const memoIndex = this.memos.findIndex(m => m.id === deleteId);
            if (memoIndex !== -1) {
                this.memos.splice(memoIndex, 1);
                
                if (this.currentMemo && this.currentMemo.id === deleteId) {
                    this.showMemoList();
                    this.currentMemo = null;
                }
            }
        } else if (deleteType === 'folder') {
            const folderIndex = this.folders.findIndex(f => f.id === deleteId);
            if (folderIndex !== -1) {
                this.folders.splice(folderIndex, 1);
                this.memos = this.memos.filter(memo => memo.folderId !== deleteId);
                this.folderPasswords.delete(deleteId);
                
                if (this.currentFolder && this.currentFolder.id === deleteId) {
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
            }
        }
        
        this.saveLocalData();
        
        // 立即同步到GitHub
        if (this.config.storageType === 'github') {
            console.log('立即同步删除操作');
            this.syncWithGitHub();
        }
        
        this.renderFolders();
        this.renderMemos();
        
        this.showNotification(`"${deleteName}" 已删除`, 'success');
        this.hideModal(this.confirmModal);
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
        this.lastSync.title = `最后同步: ${now.toLocaleString()}`;
        this.lastSyncTime = now.getTime();
        localStorage.setItem('memoLastSyncTime', this.lastSyncTime.toString());
    }
    
    showNotification(message, type = 'info') {
        console.log('通知:', type, message);
        
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
            charset: 'UTF-8',
            deviceName: this.deviceName
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
            const base64Data = this.utf8ToBase64(jsonStr);
            const encoded = encodeURIComponent(base64Data);
            const baseUrl = window.location.origin + window.location.pathname;
            const shareLink = `${baseUrl}?config=${encoded}`;
            
            this.showShareDialog(shareLink, shareConfig);
            
        } catch (error) {
            console.error('生成分享链接失败:', error);
            this.showNotification('生成分享链接失败: ' + error.message, 'error');
        }
    }
    
    showShareDialog(shareLink, shareConfig) {
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
        
        if (this.modalOverlay) {
            this.modalOverlay.classList.remove('hidden');
        }
        dialog.classList.remove('hidden');
        
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
        
        if (this.modalOverlay) {
            this.modalOverlay.addEventListener('click', () => {
                dialog.remove();
                this.modalOverlay.classList.add('hidden');
            });
        }
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
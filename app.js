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
    
    // ========== UTF-8编码/解码函数（解决中文乱码）==========
    
    // UTF-8安全的Base64编码
    utf8Btoa(str) {
        try {
            // 将字符串转换为UTF-8字节数组
            const utf8Bytes = new TextEncoder().encode(str);
            let binary = '';
            for (let i = 0; i < utf8Bytes.length; i++) {
                binary += String.fromCharCode(utf8Bytes[i]);
            }
            return btoa(binary);
        } catch (error) {
            console.error('utf8Btoa error:', error);
            // 备用方案：使用encodeURIComponent
            return btoa(encodeURIComponent(str));
        }
    }
    
    // UTF-8安全的Base64解码
    utf8Atob(base64Str) {
        try {
            const binary = atob(base64Str);
            const utf8Bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                utf8Bytes[i] = binary.charCodeAt(i);
            }
            // 将UTF-8字节数组解码为字符串
            return new TextDecoder().decode(utf8Bytes);
        } catch (error) {
            console.error('utf8Atob error:', error);
            // 备用方案：使用decodeURIComponent
            return decodeURIComponent(atob(base64Str));
        }
    }
    
    // 编码JSON对象为Base64（UTF-8安全）
    encodeJSONForStorage(obj) {
        try {
            const jsonStr = JSON.stringify(obj);
            return this.utf8Btoa(jsonStr);
        } catch (error) {
            console.error('encodeJSONForStorage error:', error);
            return btoa(JSON.stringify(obj));
        }
    }
    
    // 解码Base64为JSON对象（UTF-8安全）
    decodeJSONFromStorage(base64Str) {
        try {
            const jsonStr = this.utf8Atob(base64Str);
            return JSON.parse(jsonStr);
        } catch (error) {
            console.error('decodeJSONFromStorage error:', error);
            // 尝试使用普通base64解码
            try {
                return JSON.parse(atob(base64Str));
            } catch (e2) {
                console.error('Fallback decode also failed:', e2);
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
                    config.token = this.utf8Atob(config.token);
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
            // UTF-8安全解码
            const config = this.decodeJSONFromStorage(base64);
            
            if (!config) return null;
            
            if (!config.username || !config.repo || !config.token) {
                console.log('URL配置缺少必要字段');
                return null;
            }
            
            console.log('从URL参数解析配置成功:', config.username);
            
            // 保存到localStorage
            const configToSave = {
                ...config,
                configuredAt: new Date().toISOString(),
                charset: 'UTF-8'  // 明确记录字符集
            };
            
            configToSave.token = this.utf8Btoa(config.token);
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
    
    // ========== GitHub同步功能 ==========
    
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
            // 1. 从GitHub获取远程数据
            const remoteData = await this.fetchFromGitHub();
            
            // 2. 合并数据（解决冲突）
            if (remoteData) {
                await this.mergeData(remoteData);
                console.log('数据合并完成');
            }
            
            // 3. 上传本地数据到GitHub
            await this.saveToGitHub();
            
            // 4. 更新UI
            this.renderFolders();
            if (this.currentFolder) {
                this.renderMemos();
            }
            
            this.updateLastSync();
            console.log('GitHub同步完成');
            
        } catch (error) {
            console.error('GitHub同步失败:', error);
        } finally {
            this.syncing = false;
        }
    }
    
    async fetchFromGitHub() {
        const { username, repo, token } = this.config;
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        try {
            console.log('从GitHub获取数据...');
            
            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'GitHub-Memo-App'
                }
            });
            
            if (response.ok) {
                const fileInfo = await response.json();
                if (fileInfo && fileInfo.content) {
                    // 使用UTF-8安全解码
                    const base64Str = fileInfo.content.replace(/\n/g, '');
                    const data = this.decodeJSONFromStorage(base64Str);
                    
                    if (data) {
                        console.log('从GitHub获取数据成功:', {
                            sha: fileInfo.sha?.substring(0, 8) || 'unknown',
                            folders: data.folders?.length || 0,
                            memos: data.memos?.length || 0,
                            version: data.version || 0
                        });
                        return data;
                    }
                }
            } else if (response.status === 404) {
                console.log('GitHub上还没有数据文件');
                return null;
            } else {
                console.error('GitHub API错误:', response.status, response.statusText);
                return null;
            }
        } catch (error) {
            console.error('从GitHub获取数据失败:', error);
            return null;
        }
    }
    
    async saveToGitHub() {
        const { username, repo, token } = this.config;
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        try {
            // 准备数据
            const data = {
                folders: this.folders,
                memos: this.memos,
                passwords: Array.from(this.folderPasswords.entries()),
                version: ++this.dataVersion,
                lastModified: new Date().toISOString(),
                charset: 'UTF-8',  // 明确记录字符集
                deviceId: this.deviceId,
                syncAt: new Date().toISOString()
            };
            
            // 使用UTF-8安全编码
            const content = this.encodeJSONForStorage(data);
            
            // 先尝试获取文件的SHA
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
                }
            } catch (error) {
                console.log('文件不存在，将创建新文件');
            }
            
            // 提交数据
            const commitData = {
                message: `备忘录数据同步 (v${data.version}) - ${new Date().toLocaleString()}`,
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
                console.log('数据保存到GitHub成功');
                return true;
            } else {
                const error = await response.json();
                console.error('保存到GitHub失败:', error.message);
                return false;
            }
        } catch (error) {
            console.error('保存到GitHub失败:', error);
            return false;
        }
    }
    
    async mergeData(remoteData) {
        console.log('开始合并数据...', {
            localFolders: this.folders.length,
            localMemos: this.memos.length,
            remoteFolders: remoteData.folders?.length || 0,
            remoteMemos: remoteData.memos?.length || 0
        });
        
        // 合并文件夹（以更新时间为准）
        const remoteFolders = remoteData.folders || [];
        const localFolderMap = new Map(this.folders.map(f => [f.id, f]));
        
        for (const remoteFolder of remoteFolders) {
            const localFolder = localFolderMap.get(remoteFolder.id);
            
            if (!localFolder) {
                // 远程有，本地没有，添加
                this.folders.push(remoteFolder);
            } else {
                // 两者都有，选择更新时间最新的
                const localTime = new Date(localFolder.updatedAt || localFolder.createdAt).getTime();
                const remoteTime = new Date(remoteFolder.updatedAt || remoteFolder.createdAt).getTime();
                
                if (remoteTime > localTime) {
                    // 远程更新，替换本地
                    const index = this.folders.findIndex(f => f.id === remoteFolder.id);
                    if (index !== -1) {
                        this.folders[index] = remoteFolder;
                    }
                }
            }
        }
        
        // 合并备忘录
        const remoteMemos = remoteData.memos || [];
        const localMemoMap = new Map(this.memos.map(m => [m.id, m]));
        
        for (const remoteMemo of remoteMemos) {
            const localMemo = localMemoMap.get(remoteMemo.id);
            
            if (!localMemo) {
                // 远程有，本地没有，添加
                this.memos.push(remoteMemo);
            } else {
                // 两者都有，选择更新时间最新的
                const localTime = new Date(localMemo.updatedAt || localMemo.createdAt).getTime();
                const remoteTime = new Date(remoteMemo.updatedAt || remoteMemo.createdAt).getTime();
                
                if (remoteTime > localTime) {
                    // 远程更新，替换本地
                    const index = this.memos.findIndex(m => m.id === remoteMemo.id);
                    if (index !== -1) {
                        this.memos[index] = remoteMemo;
                    }
                }
            }
        }
        
        // 合并密码（远程优先）
        const remotePasswords = new Map(remoteData.passwords || []);
        this.folderPasswords = new Map([...remotePasswords, ...this.folderPasswords]);
        
        // 使用更高的版本号
        this.dataVersion = Math.max(this.dataVersion, remoteData.version || 0);
        
        console.log('数据合并完成', {
            mergedFolders: this.folders.length,
            mergedMemos: this.memos.length,
            finalVersion: this.dataVersion
        });
        
        // 保存合并后的数据到本地
        this.saveLocalData();
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
        
        // 如果是GitHub模式，启动同步
        if (this.config.storageType === 'github') {
            this.startAutoSync();
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
    
    async loadData() {
        console.log('加载数据...');
        try {
            // 1. 加载本地数据
            await this.loadLocalData();
            
            // 2. 如果是GitHub模式，同步数据
            if (this.config.storageType === 'github') {
                await this.syncWithGitHub();
            }
            
            // 3. 渲染UI
            this.renderFolders();
            this.updateLastSync();
            
            console.log('数据加载完成', {
                folders: this.folders.length,
                memos: this.memos.length,
                version: this.dataVersion
            });
            
        } catch (error) {
            console.error('加载数据失败:', error);
            alert('数据加载失败: ' + error.message);
        }
    }
    
    async loadLocalData() {
        const saved = localStorage.getItem('memoLocalData');
        console.log('从localStorage加载数据:', saved ? '有数据' : '无数据');
        
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.folders = data.folders || [];
                this.memos = data.memos || [];
                this.folderPasswords = new Map(data.passwords || []);
                this.dataVersion = data.version || 0;
                console.log('本地数据加载成功', {
                    folders: this.folders.length,
                    memos: this.memos.length,
                    version: this.dataVersion
                });
            } catch (e) {
                console.error('本地数据解析失败:', e);
                this.initializeEmptyData();
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
            deviceId: this.deviceId
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
            
            folderEl.innerHTML = `
                <div class="folder-content">
                    <i class="fas fa-folder folder-icon ${folder.visibility === 'private' ? 'folder-private' : ''}"></i>
                    <span class="folder-name">${this.escapeHtml(folder.name)}</span>
                </div>
                <div class="folder-meta">
                    ${folder.visibility === 'private' ? '<i class="fas fa-lock" title="密码保护"></i>' : ''}
                    <span class="folder-date">${new Date(folder.updatedAt || folder.createdAt).toLocaleDateString()}</span>
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
            alert('请输入文件夹名称');
            return;
        }
        
        const visibility = document.querySelector('input[name="visibility"]:checked');
        if (!visibility) {
            alert('请选择权限设置');
            return;
        }
        
        const visibilityValue = visibility.value;
        const password = visibilityValue === 'private' && this.folderPasswordInput ? 
            this.folderPasswordInput.value : '';
        
        if (visibilityValue === 'private' && password.length < 4) {
            alert('密码至少需要4位字符');
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
            this.folderPasswords.set(folder.id, this.utf8Btoa(password));
        }
        
        this.saveLocalData();
        
        // 如果是GitHub模式，同步到云端
        if (this.config.storageType === 'github') {
            this.syncWithGitHub();
        }
        
        this.renderFolders();
        this.hideModal(this.newFolderModal);
        this.selectFolder(folder);
        
        alert('文件夹创建成功: ' + name);
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
            alert('请先选择一个文件夹');
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
            
            const contentPreview = memo.content ? 
                memo.content.substring(0, 150).replace(/\n/g, ' ') + (memo.content.length > 150 ? '...' : '') : 
                '暂无内容';
            
            const date = new Date(memo.updatedAt || memo.createdAt);
            const dateStr = date.toLocaleDateString();
            
            memoEl.innerHTML = `
                <div class="memo-header">
                    <h3 title="${this.escapeHtml(memo.title)}">${this.escapeHtml(memo.title)}</h3>
                    <span class="memo-date">${dateStr}</span>
                </div>
                <div class="memo-content">${this.escapeHtml(contentPreview)}</div>
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
            alert('没有可保存的备忘录');
            return;
        }
        
        const title = this.memoTitle.value.trim();
        const content = this.memoContent.value.trim();
        
        if (!title) {
            alert('请输入备忘录标题');
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
        }
        
        this.renderMemos();
        
        alert('备忘录已保存: ' + title);
    }
    
    // ========== 分享配置 ==========
    
    showShareConfigModal() {
        console.log('显示分享配置模态框');
        
        if (!this.config.username || !this.config.repo || !this.config.token) {
            alert('请先配置GitHub信息');
            return;
        }
        
        const shareConfig = {
            username: this.config.username,
            repo: this.config.repo,
            token: this.config.token,
            storageType: this.config.storageType,
            sharedAt: new Date().toISOString(),
            note: 'GitHub备忘录配置链接',
            version: '1.0',
            charset: 'UTF-8'
        };
        
        try {
            const jsonStr = JSON.stringify(shareConfig);
            const base64Data = this.utf8Btoa(jsonStr);
            const encoded = encodeURIComponent(base64Data);
            const baseUrl = window.location.origin + window.location.pathname;
            const shareLink = `${baseUrl}?config=${encoded}`;
            
            // 显示分享链接
            const linkInput = document.createElement('input');
            linkInput.type = 'text';
            linkInput.value = shareLink;
            linkInput.style.width = '100%';
            linkInput.style.padding = '10px';
            linkInput.style.margin = '10px 0';
            linkInput.style.boxSizing = 'border-box';
            
            const copyBtn = document.createElement('button');
            copyBtn.textContent = '复制链接';
            copyBtn.style.padding = '10px 20px';
            copyBtn.style.backgroundColor = '#3498db';
            copyBtn.style.color = 'white';
            copyBtn.style.border = 'none';
            copyBtn.style.borderRadius = '4px';
            copyBtn.style.cursor = 'pointer';
            copyBtn.onclick = () => {
                linkInput.select();
                document.execCommand('copy');
                alert('链接已复制到剪贴板');
            };
            
            const message = document.createElement('div');
            message.innerHTML = `
                <h3>分享配置</h3>
                <p>复制以下链接分享给其他设备：</p>
                <p><small>此链接包含您的GitHub Token，请谨慎分享！</small></p>
            `;
            
            const container = document.createElement('div');
            container.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 5px 30px rgba(0,0,0,0.3);
                z-index: 10000;
                min-width: 400px;
                max-width: 500px;
            `;
            
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 9999;
            `;
            
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '关闭';
            closeBtn.style.cssText = `
                margin-top: 15px;
                padding: 8px 16px;
                background: #95a5a6;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            `;
            closeBtn.onclick = () => {
                document.body.removeChild(container);
                document.body.removeChild(overlay);
            };
            
            overlay.onclick = closeBtn.onclick;
            
            container.appendChild(message);
            container.appendChild(linkInput);
            container.appendChild(copyBtn);
            container.appendChild(closeBtn);
            
            document.body.appendChild(overlay);
            document.body.appendChild(container);
            
            linkInput.select();
            
        } catch (error) {
            console.error('生成分享链接失败:', error);
            alert('生成分享链接失败');
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
        
        // 每2分钟自动同步一次
        this.autoSyncInterval = setInterval(() => {
            if (this.config.storageType === 'github' && this.networkStatus === 'online') {
                this.syncWithGitHub().catch(console.error);
            }
        }, 2 * 60 * 1000);
        
        console.log('自动同步已启动（每2分钟一次）');
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
        if (!password) return;
        
        const storedPassword = this.folderPasswords.get(this.currentFolder.id);
        const enteredPassword = this.utf8Btoa(password);
        
        if (enteredPassword === storedPassword) {
            this.hideModal(this.passwordModal);
            this.selectFolder(this.currentFolder);
        } else {
            alert('密码错误！');
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
                message += `\n包含 ${folderMemos.length} 个备忘录`;
            }
            this.confirmMessage.textContent = message;
        }
        
        this.showModal(this.confirmModal);
    }
    
    executeDelete() {
        if (!this.pendingDelete.type || !this.pendingDelete.id) {
            this.hideModal(this.confirmModal);
            return;
        }
        
        if (this.pendingDelete.type === 'memo') {
            const memoIndex = this.memos.findIndex(m => m.id === this.pendingDelete.id);
            if (memoIndex !== -1) {
                this.memos.splice(memoIndex, 1);
                
                if (this.currentMemo && this.currentMemo.id === this.pendingDelete.id) {
                    this.showMemoList();
                    this.currentMemo = null;
                }
                
                alert('备忘录已删除');
            }
        } else if (this.pendingDelete.type === 'folder') {
            const folderIndex = this.folders.findIndex(f => f.id === this.pendingDelete.id);
            if (folderIndex !== -1) {
                this.folders.splice(folderIndex, 1);
                
                this.memos = this.memos.filter(memo => memo.folderId !== this.pendingDelete.id);
                this.folderPasswords.delete(this.pendingDelete.id);
                
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
                
                alert('文件夹已删除');
            }
        }
        
        this.saveLocalData();
        
        // 如果是GitHub模式，同步到云端
        if (this.config.storageType === 'github') {
            this.syncWithGitHub();
        }
        
        this.renderFolders();
        this.renderMemos();
        
        this.pendingDelete = { type: null, id: null };
        this.hideModal(this.confirmModal);
    }
    
    exportCurrentMemo() {
        if (!this.currentMemo) {
            alert('没有可导出的备忘录');
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
        
        alert('备忘录导出成功');
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
        
        alert('数据导出成功');
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
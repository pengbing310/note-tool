class GitHubMemo {
    constructor() {
        this.folders = [];
        this.memos = [];
        this.currentFolder = null;
        this.currentMemo = null;
        this.folderPasswords = new Map();
        
        // 从加密配置加载
        this.config = this.loadEncryptedConfig();
        
        // 删除相关
        this.pendingDelete = {
            type: null,
            id: null
        };
        
        // 同步相关
        this.syncInterval = null;
        this.autoSyncInterval = null;
        this.lastSyncTime = 0;
        this.syncing = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        
        // 数据版本
        this.dataVersion = 0;
        
        // 设备ID
        this.deviceId = this.getDeviceId();
        
        // 网络状态
        this.networkStatus = 'unknown';
        this.lastNetworkCheck = 0;
        
        // 调试模式
        this.debugMode = localStorage.getItem('memoDebugMode') === 'true';
    }
    
    loadEncryptedConfig() {
        console.log('加载配置...');
        
        // 默认配置
        const defaultConfig = {
            username: '',
            repo: 'memo-data',
            token: '',
            storageType: 'local',
            configured: false
        };
        
        // 首先检查URL参数（优先级最高）
        const urlParams = new URLSearchParams(window.location.search);
        const configFromUrl = this.getConfigFromUrlParams(urlParams);
        
        if (configFromUrl && configFromUrl.configured) {
            console.log('从URL参数加载配置成功');
            // 清除URL参数，避免重复加载
            this.clearUrlParams();
            return configFromUrl;
        }
        
        // 如果没有URL参数，从localStorage加载
        const saved = localStorage.getItem('githubMemoConfig');
        if (!saved) {
            console.log('没有找到本地配置');
            return defaultConfig;
        }
        
        try {
            const config = JSON.parse(saved);
            
            // 解密Token（如果有）
            if (config.token) {
                try {
                    config.token = atob(config.token);
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
            // 解码URL参数
            const decoded = decodeURIComponent(encodedConfig);
            const config = JSON.parse(decoded);
            
            // 验证必要字段
            if (!config.username || !config.repo || !config.token) {
                console.log('URL配置缺少必要字段');
                return null;
            }
            
            console.log('从URL参数解析配置成功:', config.username, config.repo);
            
            // 保存到localStorage，方便下次使用
            const configToSave = {
                ...config,
                configuredAt: new Date().toISOString()
            };
            
            // 加密Token后保存
            configToSave.token = btoa(config.token);
            localStorage.setItem('githubMemoConfig', JSON.stringify(configToSave));
            
            // 返回解密后的配置
            return {
                ...config,
                configured: true
            };
        } catch (error) {
            console.error('URL参数解析失败:', error);
            return null;
        }
    }
    
    clearUrlParams() {
        // 清除URL参数，避免刷新时重复加载
        if (window.history.replaceState) {
            const url = new URL(window.location);
            url.searchParams.delete('config');
            window.history.replaceState({}, '', url);
        }
    }
    
    // 生成分享链接的方法
    generateShareLink() {
        if (!this.config.username || !this.config.repo || !this.config.token) {
            alert('请先配置GitHub信息');
            return null;
        }
        
        // 准备分享的配置（不包括敏感文件夹密码）
        const shareConfig = {
            username: this.config.username,
            repo: this.config.repo,
            token: this.config.token,
            storageType: this.config.storageType,
            sharedAt: new Date().toISOString(),
            note: 'GitHub备忘录配置链接 - 请在24小时内使用'
        };
        
        // 编码为URL参数
        const encoded = encodeURIComponent(JSON.stringify(shareConfig));
        const baseUrl = window.location.origin + window.location.pathname;
        const shareLink = `${baseUrl}?config=${encoded}`;
        
        return {
            link: shareLink,
            config: shareConfig
        };
    }
    
    // 显示分享配置的模态框
    showShareConfigModal() {
        const shareData = this.generateShareLink();
        if (!shareData) return;
        
        // 创建分享模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3><i class="fas fa-share-alt"></i> 分享配置</h3>
                <p>复制以下链接，在其他设备上打开即可自动配置：</p>
                
                <div class="share-link-container">
                    <input type="text" id="shareLinkInput" class="form-control" value="${shareData.link}" readonly>
                    <button id="copyShareLinkBtn" class="btn btn-primary">
                        <i class="fas fa-copy"></i> 复制链接
                    </button>
                </div>
                
                <div class="config-info">
                    <p><strong>包含的配置信息：</strong></p>
                    <ul>
                        <li>用户名: ${shareData.config.username}</li>
                        <li>仓库: ${shareData.config.repo}</li>
                        <li>存储类型: ${shareData.config.storageType === 'github' ? 'GitHub存储' : '本地存储'}</li>
                    </ul>
                </div>
                
                <div class="share-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <div>
                        <p><strong>安全提示：</strong></p>
                        <p>1. 此链接包含您的GitHub Token，请谨慎分享！</p>
                        <p>2. 建议在24小时内使用此链接</p>
                        <p>3. 分享后可在GitHub上撤销Token</p>
                    </div>
                </div>
                
                <div class="modal-actions">
                    <button id="closeShareModalBtn" class="btn btn-secondary">关闭</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 添加遮罩层
        const overlay = document.getElementById('modalOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
        modal.classList.remove('hidden');
        
        // 绑定事件
        const copyBtn = modal.querySelector('#copyShareLinkBtn');
        const closeBtn = modal.querySelector('#closeShareModalBtn');
        const shareInput = modal.querySelector('#shareLinkInput');
        
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            shareInput.select();
            document.execCommand('copy');
            
            // 显示复制成功提示
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
            copyBtn.disabled = true;
            
            setTimeout(() => {
                copyBtn.innerHTML = originalText;
                copyBtn.disabled = false;
            }, 2000);
        });
        
        closeBtn.addEventListener('click', () => {
            modal.remove();
            if (overlay) {
                overlay.classList.add('hidden');
            }
        });
        
        // 点击遮罩层关闭
        if (overlay) {
            const closeOverlay = () => {
                modal.remove();
                overlay.classList.add('hidden');
                overlay.removeEventListener('click', closeOverlay);
            };
            overlay.addEventListener('click', closeOverlay);
        }
    }
    
    init() {
        console.log('初始化应用...配置状态:', this.config.configured);
        
        // 检查是否有配置
        if (!this.config.configured) {
            console.log('未配置，跳转到配置页面');
            // 延迟跳转，避免立即重定向
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
        
        // 启动网络监控
        this.startNetworkMonitoring();
        
        // 启动自动同步（GitHub模式）
        if (this.config.storageType === 'github') {
            this.startAutoSync();
        }
    }
    
    initElements() {
        console.log('初始化元素...');
        
        // 文件夹相关
        this.foldersList = document.getElementById('foldersList');
        this.newFolderBtn = document.getElementById('newFolderBtn');
        this.currentFolderName = document.getElementById('currentFolderName');
        this.deleteFolderBtn = document.getElementById('deleteFolderBtn');
        
        // 备忘录相关
        this.memoGrid = document.getElementById('memoGrid');
        this.newMemoBtn = document.getElementById('newMemoBtn');
        this.memoListView = document.getElementById('memoListView');
        
        // 编辑器相关
        this.editorView = document.getElementById('editorView');
        this.memoTitle = document.getElementById('memoTitle');
        this.memoContent = document.getElementById('memoContent');
        this.saveMemoBtn = document.getElementById('saveMemoBtn');
        this.closeEditorBtn = document.getElementById('closeEditorBtn');
        this.deleteMemoBtn = document.getElementById('deleteMemoBtn');
        this.exportMemoBtn = document.getElementById('exportMemoBtn');
        this.charCount = document.getElementById('charCount');
        this.lastModified = document.getElementById('lastModified');
        
        // 其他按钮
        this.exportAllBtn = document.getElementById('exportAllBtn');
        this.lastSync = document.getElementById('lastSync');
        this.storageMode = document.getElementById('storageMode');
        this.shareConfigBtn = document.getElementById('shareConfigBtn');
        
        // 更新存储模式显示
        if (this.storageMode) {
            this.storageMode.textContent = this.config.storageType === 'github' ? 'GitHub' : '本地';
        }
        
        // 模态框元素
        this.modalOverlay = document.getElementById('modalOverlay');
        this.newFolderModal = document.getElementById('newFolderModal');
        
        if (this.newFolderModal) {
            this.folderNameInput = document.getElementById('folderName');
            this.visibilityRadios = this.newFolderModal.querySelectorAll('input[name="visibility"]');
            this.passwordGroup = document.getElementById('passwordGroup');
            this.folderPasswordInput = document.getElementById('folderPassword');
            this.createFolderBtn = document.getElementById('createFolderBtn');
            this.cancelFolderBtn = document.getElementById('cancelFolderBtn');
        }
        
        this.passwordModal = document.getElementById('passwordModal');
        if (this.passwordModal) {
            this.inputPassword = document.getElementById('inputPassword');
            this.submitPasswordBtn = document.getElementById('submitPasswordBtn');
            this.cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
        }
        
        this.confirmModal = document.getElementById('confirmModal');
        if (this.confirmModal) {
            this.confirmMessage = document.getElementById('confirmMessage');
            this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
            this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        }
        
        console.log('元素初始化完成');
    }
    
    bindEvents() {
        console.log('绑定事件...');
        
        // 文件夹事件
        if (this.newFolderBtn) {
            console.log('绑定新建文件夹按钮');
            this.newFolderBtn.addEventListener('click', (e) => {
                console.log('点击新建文件夹按钮');
                e.preventDefault();
                e.stopPropagation();
                this.showNewFolderModal();
            });
        }
        
        // 模态框内的事件绑定
        if (this.visibilityRadios && this.visibilityRadios.length > 0) {
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
                e.stopPropagation();
                this.createFolder();
            });
        }
        
        if (this.cancelFolderBtn) {
            this.cancelFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.hideModal(this.newFolderModal);
            });
        }
        
        if (this.deleteFolderBtn) {
            this.deleteFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteFolder();
            });
        }
        
        // 密码事件
        if (this.submitPasswordBtn) {
            this.submitPasswordBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.verifyPassword();
            });
        }
        
        if (this.cancelPasswordBtn) {
            this.cancelPasswordBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.hideModal(this.passwordModal);
            });
        }
        
        // 备忘录事件
        if (this.newMemoBtn) {
            console.log('绑定新建备忘录按钮');
            this.newMemoBtn.addEventListener('click', (e) => {
                console.log('点击新建备忘录按钮');
                e.preventDefault();
                e.stopPropagation();
                this.createMemo();
            });
        }
        
        if (this.saveMemoBtn) {
            this.saveMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.saveMemo();
            });
        }
        
        if (this.closeEditorBtn) {
            this.closeEditorBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeEditor();
            });
        }
        
        if (this.deleteMemoBtn) {
            this.deleteMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteMemo();
            });
        }
        
        if (this.exportMemoBtn) {
            this.exportMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.exportCurrentMemo();
            });
        }
        
        if (this.exportAllBtn) {
            this.exportAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.exportAllData();
            });
        }
        
        // 分享按钮事件
        if (this.shareConfigBtn) {
            console.log('绑定分享配置按钮');
            this.shareConfigBtn.addEventListener('click', (e) => {
                console.log('点击分享配置按钮');
                e.preventDefault();
                e.stopPropagation();
                this.showShareConfigModal();
            });
        }
        
        // 删除确认事件
        if (this.confirmDeleteBtn) {
            this.confirmDeleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.executeDelete();
            });
        }
        
        if (this.cancelDeleteBtn) {
            this.cancelDeleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
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
            // 首先加载本地数据
            await this.loadLocalData();
            
            // 如果是GitHub存储模式，尝试同步远程数据
            if (this.config.storageType === 'github') {
                try {
                    await this.syncFromGitHub();
                } catch (syncError) {
                    console.warn('GitHub同步失败，使用本地数据:', syncError.message);
                    // 继续使用本地数据
                }
            }
            
            this.renderFolders();
            this.updateLastSync();
            console.log('数据加载完成');
            
            // 显示数据统计
            this.logDataStats();
            
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showNotification('数据加载失败，使用本地数据', 'error');
        }
    }
    
    async loadLocalData() {
        const saved = localStorage.getItem('memoLocalData');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.folders = data.folders || [];
                this.memos = data.memos || [];
                this.folderPasswords = new Map(data.passwords || []);
                this.dataVersion = data.version || 0;
                console.log('从本地存储加载数据成功');
            } catch (e) {
                console.error('本地数据解析失败:', e);
                this.initializeEmptyData();
            }
        } else {
            this.initializeEmptyData();
        }
    }
    
    initializeEmptyData() {
        this.folders = [];
        this.memos = [];
        this.folderPasswords = new Map();
        this.dataVersion = 0;
    }
    
    async syncFromGitHub() {
        if (this.config.storageType !== 'github' || !this.config.token) {
            return;
        }
        
        console.log('开始从GitHub同步数据...');
        
        try {
            // 检查网络
            await this.checkNetwork();
            
            if (this.networkStatus !== 'online') {
                throw new Error('网络不可用');
            }
            
            // 获取远程数据
            const remoteData = await this.fetchFromGitHub();
            
            if (!remoteData) {
                console.log('GitHub上没有数据，上传本地数据');
                await this.saveDataToGitHub();
                return;
            }
            
            console.log('获取到远程数据，开始合并...', {
                localVersion: this.dataVersion,
                remoteVersion: remoteData.version,
                localFolders: this.folders.length,
                remoteFolders: remoteData.folders?.length || 0
            });
            
            // 合并数据
            await this.mergeData(remoteData);
            
            // 保存合并后的数据到本地
            this.saveLocalData();
            
            // 上传合并后的数据到GitHub（如果有更新）
            await this.saveDataToGitHub();
            
            console.log('数据同步完成');
            this.showNotification('数据同步成功', 'success');
            
        } catch (error) {
            console.error('同步失败:', error);
            throw error;
        }
    }
    
    async fetchFromGitHub() {
        const { username, repo } = this.config;
        if (!username || !repo || !this.config.token) {
            console.log('GitHub配置不完整');
            return null;
        }
        
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        try {
            // 添加超时控制
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
            
            const response = await fetch(apiUrl, {
                signal: controller.signal,
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const fileInfo = await response.json();
                if (fileInfo.content) {
                    const content = atob(fileInfo.content.replace(/\n/g, ''));
                    const data = JSON.parse(content);
                    
                    console.log('从GitHub获取数据成功:', {
                        sha: fileInfo.sha?.substring(0, 8) || 'unknown',
                        文件夹数: data.folders?.length || 0,
                        备忘录数: data.memos?.length || 0,
                        版本: data.version || 0
                    });
                    
                    return data;
                }
            } else if (response.status === 404) {
                console.log('GitHub上没有数据文件');
                return null;
            } else if (response.status === 401 || response.status === 403) {
                console.error('GitHub认证失败，请检查Token');
                this.showNotification('GitHub认证失败，请检查Token', 'error');
                return null;
            } else {
                console.error('GitHub API错误:', response.status, response.statusText);
                return null;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('请求超时');
                throw new Error('请求超时，请检查网络连接');
            } else {
                console.error('从GitHub获取数据失败:', error);
                throw error;
            }
        }
        
        return null;
    }
    
    // 改进的数据合并方法
    async mergeData(remoteData) {
        if (!remoteData) return;
        
        const remoteFolders = remoteData.folders || [];
        const remoteMemos = remoteData.memos || [];
        const remotePasswords = new Map(remoteData.passwords || []);
        
        console.log('开始合并数据:', {
            本地文件夹: this.folders.length,
            本地备忘录: this.memos.length,
            远程文件夹: remoteFolders.length,
            远程备忘录: remoteMemos.length
        });
        
        // 创建ID映射，快速查找
        const localFolderMap = new Map(this.folders.map(f => [f.id, f]));
        const localMemoMap = new Map(this.memos.map(m => [m.id, m]));
        
        const remoteFolderMap = new Map(remoteFolders.map(f => [f.id, f]));
        const remoteMemoMap = new Map(remoteMemos.map(m => [m.id, m]));
        
        // 合并文件夹（远程优先）
        const mergedFolders = [];
        const allFolderIds = new Set([
            ...Array.from(localFolderMap.keys()),
            ...Array.from(remoteFolderMap.keys())
        ]);
        
        for (const folderId of allFolderIds) {
            const localFolder = localFolderMap.get(folderId);
            const remoteFolder = remoteFolderMap.get(folderId);
            
            if (remoteFolder && localFolder) {
                // 两个设备都有，选择更新时间最新的
                const localTime = new Date(localFolder.updatedAt || localFolder.createdAt || 0).getTime();
                const remoteTime = new Date(remoteFolder.updatedAt || remoteFolder.createdAt || 0).getTime();
                
                if (remoteTime > localTime) {
                    mergedFolders.push(remoteFolder);
                } else {
                    mergedFolders.push(localFolder);
                }
            } else if (remoteFolder) {
                // 只有远程有，使用远程
                mergedFolders.push(remoteFolder);
            } else if (localFolder) {
                // 只有本地有，使用本地
                mergedFolders.push(localFolder);
            }
        }
        
        // 合并备忘录（同样远程优先）
        const mergedMemos = [];
        const allMemoIds = new Set([
            ...Array.from(localMemoMap.keys()),
            ...Array.from(remoteMemoMap.keys())
        ]);
        
        for (const memoId of allMemoIds) {
            const localMemo = localMemoMap.get(memoId);
            const remoteMemo = remoteMemoMap.get(memoId);
            
            if (remoteMemo && localMemo) {
                // 两个设备都有，选择更新时间最新的
                const localTime = new Date(localMemo.updatedAt || localMemo.createdAt || 0).getTime();
                const remoteTime = new Date(remoteMemo.updatedAt || remoteMemo.createdAt || 0).getTime();
                
                if (remoteTime > localTime) {
                    mergedMemos.push(remoteMemo);
                } else {
                    mergedMemos.push(localMemo);
                }
            } else if (remoteMemo) {
                // 只有远程有，使用远程
                mergedMemos.push(remoteMemo);
            } else if (localMemo) {
                // 只有本地有，使用本地
                mergedMemos.push(localMemo);
            }
        }
        
        // 合并密码（远程优先）
        const mergedPasswords = new Map([...remotePasswords, ...this.folderPasswords]);
        
        // 过滤掉文件夹已删除的备忘录
        const validFolderIds = new Set(mergedFolders.map(f => f.id));
        const validMemos = mergedMemos.filter(memo => validFolderIds.has(memo.folderId));
        
        // 更新数据
        this.folders = mergedFolders.sort((a, b) => 
            new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
        );
        
        this.memos = validMemos.sort((a, b) => 
            new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
        );
        
        this.folderPasswords = mergedPasswords;
        
        // 使用更高的版本号
        this.dataVersion = Math.max(this.dataVersion, remoteData.version || 0);
        
        console.log('数据合并完成:', {
            合并后文件夹: this.folders.length,
            合并后备忘录: this.memos.length,
            最终版本: this.dataVersion
        });
    }
    
    // 获取设备ID
    getDeviceId() {
        let deviceId = localStorage.getItem('memoDeviceId');
        if (!deviceId) {
            deviceId = 'device_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('memoDeviceId', deviceId);
        }
        return deviceId;
    }
    
    renderFolders() {
        console.log('渲染文件夹...');
        if (!this.foldersList) return;
        
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
        
        this.folders.forEach(folder => {
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
            
            // 添加删除按钮
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
                e.preventDefault();
                // 确保点击的不是删除按钮
                if (!e.target.closest('.folder-delete-btn')) {
                    this.selectFolder(folder);
                }
            });
            
            this.foldersList.appendChild(folderEl);
        });
        
        // 确保滚动区域正常工作
        this.ensureScrollable();
    }
    
    // 修复手机端文件夹显示问题
    ensureScrollable() {
        if (!this.foldersList) return;
        
        // 检查是否需要滚动
        const hasScroll = this.foldersList.scrollHeight > this.foldersList.clientHeight;
        
        if (hasScroll) {
            this.foldersList.classList.add('scrollable');
        } else {
            this.foldersList.classList.remove('scrollable');
        }
    }
    
    showNewFolderModal() {
        console.log('显示新建文件夹模态框');
        if (!this.newFolderModal || !this.folderNameInput) return;
        
        this.folderNameInput.value = '';
        
        // 重置单选按钮
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
            id: Date.now().toString(),
            name: name,
            visibility: visibilityValue,
            createdAt: now,
            updatedAt: now,
            deviceId: this.deviceId
        };
        
        this.folders.unshift(folder); // 添加到开头
        
        if (visibilityValue === 'private' && password) {
            this.folderPasswords.set(folder.id, btoa(password));
        }
        
        // 保存数据
        this.saveLocalData();
        
        // 同步到GitHub
        if (this.config.storageType === 'github') {
            this.scheduleSync();
        }
        
        this.renderFolders();
        this.hideModal(this.newFolderModal);
        
        // 选择新创建的文件夹
        this.selectFolder(folder);
        
        this.showNotification('文件夹创建成功', 'success');
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
        
        // 更新UI
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        
        // 找到并激活当前文件夹
        const folderItems = document.querySelectorAll('.folder-item');
        folderItems.forEach((item, index) => {
            if (this.folders[index] && this.folders[index].id === folder.id) {
                item.classList.add('active');
            }
        });
        
        if (this.currentFolderName) {
            this.currentFolderName.textContent = folder.name;
        }
        
        // 确保新建备忘录按钮可用
        if (this.newMemoBtn) {
            this.newMemoBtn.disabled = false;
        }
        
        if (this.deleteFolderBtn) {
            this.deleteFolderBtn.disabled = false;
        }
        
        this.showMemoList();
        this.renderMemos();
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
        if (!password) return;
        
        const storedPassword = this.folderPasswords.get(this.currentFolder.id);
        const enteredPassword = btoa(password);
        
        if (enteredPassword === storedPassword) {
            this.folderPasswords.set(this.currentFolder.id, storedPassword);
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
    
    renderMemos() {
        if (!this.currentFolder || !this.memoGrid) return;
        
        const folderMemos = this.memos.filter(memo => memo.folderId === this.currentFolder.id);
        
        this.memoGrid.innerHTML = '';
        
        if (folderMemos.length === 0) {
            this.memoGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-sticky-note"></i>
                    <h3>暂无备忘录</h3>
                    <p>点击"新建备忘录"开始记录</p>
                    <p class="tip">所有备忘录将自动保存</p>
                </div>
            `;
            return;
        }
        
        folderMemos.forEach(memo => {
            const memoEl = document.createElement('div');
            memoEl.className = 'memo-card';
            
            // 预览内容（限制长度）
            const preview = memo.content.length > 200 ? 
                memo.content.substring(0, 200) + '...' : 
                memo.content;
            
            memoEl.innerHTML = `
                <div class="memo-header">
                    <h3>${this.escapeHtml(memo.title)}</h3>
                    <span class="memo-date">${new Date(memo.updatedAt).toLocaleString('zh-CN')}</span>
                </div>
                <div class="memo-content">${this.escapeHtml(preview)}</div>
            `;
            
            // 添加删除按钮
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'memo-action-btn';
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
            deleteBtn.title = '删除备忘录';
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteMemo(memo.id);
            });
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'memo-actions';
            actionsDiv.appendChild(deleteBtn);
            memoEl.appendChild(actionsDiv);
            
            memoEl.addEventListener('click', (e) => {
                e.preventDefault();
                this.editMemo(memo.id);
            });
            this.memoGrid.appendChild(memoEl);
        });
    }
    
    createMemo() {
        console.log('创建备忘录...');
        if (!this.currentFolder) {
            alert('请先选择文件夹');
            return;
        }
        
        const now = new Date().toISOString();
        this.currentMemo = {
            id: Date.now().toString(),
            folderId: this.currentFolder.id,
            title: '新备忘录',
            content: '',
            createdAt: now,
            updatedAt: now,
            deviceId: this.deviceId
        };
        
        this.openEditor();
    }
    
    editMemo(memoId) {
        console.log('编辑备忘录:', memoId);
        const memo = this.memos.find(m => m.id === memoId);
        if (memo) {
            this.currentMemo = memo;
            this.openEditor();
        }
    }
    
    openEditor() {
        console.log('打开编辑器');
        if (!this.memoTitle || !this.memoContent) return;
        
        this.memoTitle.value = this.currentMemo.title;
        this.memoContent.value = this.currentMemo.content;
        this.updateEditorInfo();
        this.showEditor();
        
        // 聚焦到标题
        setTimeout(() => {
            if (this.memoTitle) {
                this.memoTitle.focus();
                this.memoTitle.select();
            }
        }, 100);
    }
    
    closeEditor() {
        console.log('关闭编辑器');
        this.currentMemo = null;
        this.showMemoList();
        this.renderMemos();
    }
    
    updateEditorInfo() {
        if (!this.currentMemo || !this.charCount || !this.lastModified) return;
        
        const charCount = this.memoContent.value.length + this.memoTitle.value.length;
        this.charCount.textContent = charCount;
        this.lastModified.textContent = '刚刚';
        
        // 更新当前备忘录
        this.currentMemo.title = this.memoTitle.value.trim() || '无标题';
        this.currentMemo.content = this.memoContent.value;
        this.currentMemo.updatedAt = new Date().toISOString();
    }
    
    saveMemo() {
        console.log('保存备忘录');
        if (!this.currentMemo) return;
        
        // 如果是新备忘录，添加到列表
        const existingIndex = this.memos.findIndex(m => m.id === this.currentMemo.id);
        if (existingIndex === -1) {
            this.memos.unshift(this.currentMemo);
        } else {
            this.memos[existingIndex] = this.currentMemo;
        }
        
        // 保存数据
        this.saveLocalData();
        
        // 同步到GitHub
        if (this.config.storageType === 'github') {
            this.scheduleSync();
        }
        
        this.closeEditor();
        
        this.showNotification('备忘录保存成功', 'success');
    }
    
    async saveDataToGitHub() {
        if (this.config.storageType !== 'github' || !this.config.token) {
            return;
        }
        
        console.log('保存数据到GitHub...');
        
        const { username, repo } = this.config;
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        try {
            // 检查网络
            await this.checkNetwork();
            
            if (this.networkStatus !== 'online') {
                throw new Error('网络不可用，无法同步到GitHub');
            }
            
            // 准备数据
            const data = {
                folders: this.folders,
                memos: this.memos,
                passwords: Array.from(this.folderPasswords.entries()),
                lastUpdated: new Date().toISOString(),
                version: this.dataVersion + 1,
                deviceId: this.deviceId
            };
            
            const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
            
            // 先获取文件SHA（如果存在）
            let sha = null;
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                
                const response = await fetch(apiUrl, {
                    signal: controller.signal,
                    headers: { 
                        'Authorization': `token ${this.config.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    const fileInfo = await response.json();
                    sha = fileInfo.sha;
                }
            } catch (error) {
                // 文件不存在，创建新文件
                console.log('文件不存在，将创建新文件');
            }
            
            const body = {
                message: `Update memo data ${new Date().toISOString()}`,
                content: content,
                sha: sha
            };
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(apiUrl, {
                method: 'PUT',
                signal: controller.signal,
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify(body)
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const result = await response.json();
                this.dataVersion++;
                this.lastSyncTime = Date.now();
                this.updateLastSync();
                
                console.log('数据保存到GitHub成功:', {
                    sha: result.sha?.substring(0, 8) || 'unknown',
                    版本: this.dataVersion
                });
                
                return result;
            } else {
                const error = await response.json();
                throw new Error(error.message || 'GitHub保存失败');
            }
            
        } catch (error) {
            console.error('保存到GitHub失败:', error);
            throw error;
        }
    }
    
    saveLocalData() {
        const data = {
            folders: this.folders,
            memos: this.memos,
            passwords: Array.from(this.folderPasswords.entries()),
            version: this.dataVersion,
            lastUpdated: new Date().toISOString(),
            deviceId: this.deviceId
        };
        
        localStorage.setItem('memoLocalData', JSON.stringify(data));
        console.log('数据已保存到本地存储');
    }
    
    // 网络监控
    startNetworkMonitoring() {
        // 监听网络状态变化
        window.addEventListener('online', () => {
            this.networkStatus = 'online';
            console.log('网络已连接');
            this.showNotification('网络已连接', 'success');
            
            // 网络恢复后尝试同步
            if (this.config.storageType === 'github') {
                this.scheduleSync();
            }
        });
        
        window.addEventListener('offline', () => {
            this.networkStatus = 'offline';
            console.log('网络已断开');
            this.showNotification('网络已断开', 'error');
        });
        
        // 初始检查
        this.checkNetwork();
    }
    
    async checkNetwork() {
        const now = Date.now();
        
        // 避免频繁检查（至少间隔5秒）
        if (now - this.lastNetworkCheck < 5000) {
            return this.networkStatus;
        }
        
        this.lastNetworkCheck = now;
        
        try {
            // 简单检查网络连接
            const response = await fetch('https://api.github.com', {
                method: 'HEAD',
                cache: 'no-cache'
            });
            
            this.networkStatus = response.ok ? 'online' : 'offline';
        } catch (error) {
            this.networkStatus = 'offline';
        }
        
        return this.networkStatus;
    }
    
    // 启动自动同步
    startAutoSync() {
        // 清除之前的定时器
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
        }
        
        // 每60秒检查一次同步
        this.autoSyncInterval = setInterval(() => {
            this.autoSync();
        }, 60000); // 60秒
    }
    
    async autoSync() {
        if (this.syncing) {
            if (this.debugMode) console.log('同步进行中，跳过本次');
            return;
        }
        
        if (this.config.storageType !== 'github') {
            return;
        }
        
        // 检查网络
        const networkStatus = await this.checkNetwork();
        if (networkStatus !== 'online') {
            if (this.debugMode) console.log('网络不可用，跳过同步');
            return;
        }
        
        console.log('自动同步检查...');
        
        try {
            this.syncing = true;
            
            // 获取远程数据
            const remoteData = await this.fetchFromGitHub();
            
            if (remoteData) {
                // 检查版本是否需要同步
                if (remoteData.version > this.dataVersion) {
                    console.log('检测到新版本，开始同步...');
                    await this.mergeData(remoteData);
                    this.saveLocalData();
                    this.renderFolders();
                    
                    if (this.currentFolder) {
                        this.renderMemos();
                    }
                    
                    this.showNotification('数据已从云端更新', 'info');
                }
            }
            
            this.syncing = false;
            this.retryCount = 0;
            
        } catch (error) {
            console.error('自动同步失败:', error.message);
            this.syncing = false;
            this.retryCount++;
            
            // 重试逻辑（最多3次）
            if (this.retryCount <= this.maxRetries) {
                const delay = Math.min(30000, 5000 * Math.pow(2, this.retryCount - 1));
                console.log(`将在${delay/1000}秒后重试 (${this.retryCount}/${this.maxRetries})`);
                
                setTimeout(() => this.autoSync(), delay);
            } else {
                console.log('达到最大重试次数，停止自动同步');
                this.showNotification('同步失败，请检查网络和Token', 'error');
            }
        }
    }
    
    // 调度同步
    scheduleSync() {
        if (this.syncing) {
            if (this.debugMode) console.log('同步进行中，延迟执行');
            setTimeout(() => this.scheduleSync(), 2000);
            return;
        }
        
        console.log('调度同步...');
        
        // 立即执行同步
        setTimeout(async () => {
            try {
                await this.saveDataToGitHub();
                this.showNotification('数据已同步到云端', 'success');
            } catch (error) {
                console.error('同步失败:', error.message);
                
                // 不显示错误通知，避免打扰用户
                if (this.debugMode) {
                    this.showNotification(`同步失败: ${error.message}`, 'error');
                }
                
                // 5秒后重试
                setTimeout(() => this.scheduleSync(), 5000);
            }
        }, 1000);
    }
    
    // 删除文件夹
    promptDeleteFolder(folderId = null) {
        const folder = folderId ? this.folders.find(f => f.id === folderId) : this.currentFolder;
        if (!folder) return;
        
        // 检查文件夹是否有备忘录
        const folderMemos = this.memos.filter(m => m.folderId === folder.id);
        
        this.pendingDelete = {
            type: 'folder',
            id: folder.id
        };
        
        let message = `确定要删除文件夹"${folder.name}"吗？`;
        if (folderMemos.length > 0) {
            message += `\n\n⚠️ 警告：该文件夹包含 ${folderMemos.length} 个备忘录，删除文件夹将同时删除这些备忘录！`;
        }
        
        if (this.confirmMessage) {
            this.confirmMessage.textContent = message;
        }
        this.showModal(this.confirmModal);
    }
    
    // 删除备忘录
    promptDeleteMemo(memoId = null) {
        const memo = memoId ? this.memos.find(m => m.id === memoId) : this.currentMemo;
        if (!memo) return;
        
        this.pendingDelete = {
            type: 'memo',
            id: memo.id
        };
        
        if (this.confirmMessage) {
            this.confirmMessage.textContent = `确定要删除备忘录"${memo.title}"吗？`;
        }
        this.showModal(this.confirmModal);
    }
    
    // 执行删除
    executeDelete() {
        if (!this.pendingDelete.type || !this.pendingDelete.id) return;
        
        if (this.pendingDelete.type === 'folder') {
            this.deleteFolder(this.pendingDelete.id);
        } else if (this.pendingDelete.type === 'memo') {
            this.deleteMemo(this.pendingDelete.id);
        }
        
        this.pendingDelete = { type: null, id: null };
        this.hideModal(this.confirmModal);
        
        // 立即同步
        if (this.config.storageType === 'github') {
            this.scheduleSync();
        }
    }
    
    deleteFolder(folderId) {
        // 删除文件夹
        this.folders = this.folders.filter(f => f.id !== folderId);
        
        // 删除文件夹下的所有备忘录
        this.memos = this.memos.filter(m => m.folderId !== folderId);
        
        // 删除密码记录
        this.folderPasswords.delete(folderId);
        
        // 如果删除的是当前文件夹，清空当前选择
        if (this.currentFolder?.id === folderId) {
            this.currentFolder = null;
            this.currentMemo = null;
            if (this.currentFolderName) {
                this.currentFolderName.textContent = '请选择文件夹';
            }
            if (this.newMemoBtn) {
                this.newMemoBtn.disabled = true;
            }
            if (this.deleteFolderBtn) {
                this.deleteFolderBtn.disabled = true;
            }
            this.showMemoList();
            if (this.memoGrid) {
                this.memoGrid.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-sticky-note"></i>
                        <h3>请选择文件夹</h3>
                        <p>选择一个文件夹开始记录</p>
                    </div>
                `;
            }
        }
        
        // 保存数据
        this.saveLocalData();
        
        this.renderFolders();
        
        this.showNotification('文件夹删除成功', 'success');
    }
    
    deleteMemo(memoId) {
        // 删除备忘录
        this.memos = this.memos.filter(m => m.id !== memoId);
        
        // 如果删除的是当前备忘录，关闭编辑器
        if (this.currentMemo?.id === memoId) {
            this.closeEditor();
        }
        
        // 保存数据
        this.saveLocalData();
        
        this.renderMemos();
        
        this.showNotification('备忘录删除成功', 'success');
    }
    
    exportCurrentMemo() {
        if (!this.currentMemo) return;
        
        const data = {
            memo: this.currentMemo,
            exportedAt: new Date().toISOString()
        };
        
        this.downloadJSON(data, `memo-${this.currentMemo.id}.json`);
    }
    
    exportAllData() {
        const data = {
            folders: this.folders,
            memos: this.memos,
            passwords: Array.from(this.folderPasswords.entries()),
            exportedAt: new Date().toISOString()
        };
        
        this.downloadJSON(data, 'memo-backup.json');
    }
    
    downloadJSON(data, filename) {
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    updateLastSync() {
        if (this.lastSync) {
            const now = new Date();
            this.lastSync.textContent = now.toLocaleTimeString('zh-CN');
            this.lastSync.title = now.toLocaleString('zh-CN');
        }
    }
    
    showModal(modal) {
        if (!this.modalOverlay || !modal) return;
        
        this.modalOverlay.classList.remove('hidden');
        modal.classList.remove('hidden');
    }
    
    hideModal(modal) {
        if (!this.modalOverlay || !modal) return;
        
        this.modalOverlay.classList.add('hidden');
        modal.classList.add('hidden');
    }
    
    // 显示通知
    showNotification(message, type = 'info') {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
            <button class="notification-close"><i class="fas fa-times"></i></button>
        `;
        
        // 添加到页面
        document.body.appendChild(notification);
        
        // 显示通知
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        // 关闭按钮事件
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        });
        
        // 3秒后自动隐藏（成功消息）或5秒后（错误消息）
        const duration = type === 'error' ? 5000 : 3000;
        setTimeout(() => {
            if (notification.parentNode) {
                notification.classList.remove('show');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, duration);
    }
    
    // 记录数据统计
    logDataStats() {
        if (this.debugMode) {
            console.log('数据统计:', {
                文件夹数: this.folders.length,
                备忘录数: this.memos.length,
                密码数: this.folderPasswords.size,
                数据版本: this.dataVersion,
                设备ID: this.deviceId,
                网络状态: this.networkStatus
            });
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM已加载，初始化应用...');
    window.app = new GitHubMemo();
    window.app.init();
});
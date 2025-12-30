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
        this.networkStatus = navigator.onLine ? 'online' : 'offline';
        
        // 调试模式
        this.debugMode = localStorage.getItem('memoDebugMode') === 'true';
        
        // 同步队列
        this.syncQueue = [];
        this.processingQueue = false;
        
        // GitHub API状态
        this.githubApiAvailable = true;
        this.rateLimitExceeded = false;
        this.rateLimitResetTime = 0;
        
        // 请求计数器（用于调试）
        this.requestCount = 0;
    }
    
    // 安全Base64编码（支持中文）
    safeBtoa(str) {
        try {
            // 将字符串转换为UTF-8字节数组
            const utf8Bytes = new TextEncoder().encode(str);
            let binary = '';
            for (let i = 0; i < utf8Bytes.length; i++) {
                binary += String.fromCharCode(utf8Bytes[i]);
            }
            return btoa(binary);
        } catch (error) {
            console.error('safeBtoa error:', error);
            // 回退到普通btoa
            return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, 
                (match, p1) => String.fromCharCode('0x' + p1)));
        }
    }
    
    // 安全Base64解码（支持中文）
    safeAtob(base64Str) {
        try {
            // 先进行base64解码
            const binary = atob(base64Str);
            const utf8Bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                utf8Bytes[i] = binary.charCodeAt(i);
            }
            // 将UTF-8字节数组解码为字符串
            return new TextDecoder().decode(utf8Bytes);
        } catch (error) {
            console.error('safeAtob error:', error);
            // 回退到普通atob
            return decodeURIComponent(atob(base64Str).split('').map(c => 
                '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        }
    }
    
    // 安全的JSON字符串编码
    encodeJSONForStorage(obj) {
        try {
            const jsonStr = JSON.stringify(obj);
            return this.safeBtoa(jsonStr);
        } catch (error) {
            console.error('encodeJSONForStorage error:', error);
            return btoa(JSON.stringify(obj));
        }
    }
    
    // 安全的JSON字符串解码
    decodeJSONFromStorage(base64Str) {
        try {
            const jsonStr = this.safeAtob(base64Str);
            return JSON.parse(jsonStr);
        } catch (error) {
            console.error('decodeJSONFromStorage error:', error);
            // 尝试兼容旧格式
            try {
                return JSON.parse(atob(base64Str));
            } catch (e2) {
                console.error('Fallback decode also failed:', e2);
                return null;
            }
        }
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
            
            // 解密Token（使用安全Base64）
            if (config.token) {
                try {
                    config.token = this.safeAtob(config.token);
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
            // 1. URL解码
            const base64 = decodeURIComponent(encodedConfig);
            
            // 2. 使用安全Base64解码
            const config = this.decodeJSONFromStorage(base64);
            
            if (!config) {
                console.log('配置解析失败');
                return null;
            }
            
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
            
            // 加密Token后保存（使用安全Base64）
            configToSave.token = this.safeBtoa(config.token);
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
        // 清除URL参数，避免重复加载
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
            note: 'GitHub备忘录配置链接 - 请在24小时内使用',
            version: '1.0',
            charset: 'UTF-8' // 明确指定字符集
        };
        
        try {
            // 1. 编码为Base64（使用安全编码）
            const base64Data = this.encodeJSONForStorage(shareConfig);
            
            // 2. URL编码
            const encoded = encodeURIComponent(base64Data);
            const baseUrl = window.location.origin + window.location.pathname;
            const shareLink = `${baseUrl}?config=${encoded}`;
            
            return {
                link: shareLink,
                config: shareConfig
            };
        } catch (error) {
            console.error('生成分享链接失败:', error);
            alert('生成分享链接失败，请重试');
            return null;
        }
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
                        <li>用户名: ${this.escapeHtml(shareData.config.username)}</li>
                        <li>仓库: ${this.escapeHtml(shareData.config.repo)}</li>
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
            // 检查网络状态
            if (this.networkStatus !== 'online') {
                console.log('网络不可用，跳过同步');
                return;
            }
            
            // 检查速率限制
            if (this.rateLimitExceeded) {
                const now = Date.now();
                if (now < this.rateLimitResetTime) {
                    const remainingMinutes = Math.ceil((this.rateLimitResetTime - now) / 60000);
                    console.log(`速率限制中，请等待 ${remainingMinutes} 分钟`);
                    this.showNotification(`GitHub API速率限制，请等待 ${remainingMinutes} 分钟`, 'warning');
                    return;
                } else {
                    // 速率限制已过期
                    this.rateLimitExceeded = false;
                    this.rateLimitResetTime = 0;
                }
            }
            
            // 获取远程数据
            const remoteData = await this.fetchFromGitHub();
            
            if (!remoteData) {
                console.log('GitHub上没有数据，等待用户操作');
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
            
            console.log('数据同步完成');
            
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
            
            this.requestCount++;
            console.log(`GitHub API请求 #${this.requestCount}`);
            
            const response = await fetch(apiUrl, {
                signal: controller.signal,
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'GitHub-Memo-App'
                }
            });
            
            clearTimeout(timeoutId);
            
            // 检查速率限制头
            const remaining = response.headers.get('X-RateLimit-Remaining');
            const resetTime = response.headers.get('X-RateLimit-Reset');
            
            if (remaining && parseInt(remaining) < 10) {
                console.warn(`GitHub API剩余请求次数: ${remaining}`);
                if (resetTime) {
                    this.rateLimitResetTime = parseInt(resetTime) * 1000;
                    console.log(`速率限制将在 ${new Date(this.rateLimitResetTime).toLocaleTimeString()} 重置`);
                }
            }
            
            if (response.ok) {
                const fileInfo = await response.json();
                if (fileInfo && fileInfo.content) {
                    // 使用安全的Base64解码，支持中文
                    const base64Str = fileInfo.content.replace(/\n/g, '');
                    const data = this.decodeJSONFromStorage(base64Str);
                    
                    if (!data) {
                        console.log('GitHub数据解析失败');
                        return null;
                    }
                    
                    console.log('从GitHub获取数据成功:', {
                        sha: fileInfo.sha ? fileInfo.sha.substring(0, 8) : 'unknown',
                        文件夹数: data.folders?.length || 0,
                        备忘录数: data.memos?.length || 0,
                        版本: data.version || 0,
                        剩余请求次数: remaining
                    });
                    
                    return data;
                } else {
                    console.log('GitHub返回的数据格式不正确');
                    return null;
                }
            } else if (response.status === 404) {
                console.log('GitHub上没有数据文件');
                return null;
            } else if (response.status === 401 || response.status === 403) {
                const errorData = await response.json();
                console.error('GitHub认证失败:', errorData.message);
                
                if (errorData.message && errorData.message.includes('rate limit')) {
                    // 处理速率限制错误
                    this.handleRateLimitError(errorData);
                    return null;
                }
                
                this.showNotification('GitHub认证失败，请检查Token', 'error');
                return null;
            } else if (response.status === 429) {
                // 429 Too Many Requests
                const errorData = await response.json();
                this.handleRateLimitError(errorData);
                return null;
            } else {
                const errorText = await response.text();
                console.error('GitHub API错误:', response.status, response.statusText, errorText);
                return null;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('请求超时');
                return null;
            } else {
                console.error('从GitHub获取数据失败:', error);
                return null;
            }
        }
    }
    
    // 处理速率限制错误
    handleRateLimitError(errorData) {
        this.rateLimitExceeded = true;
        
        let resetTime = Date.now() + 3600000; // 默认1小时后
        if (errorData.message) {
            // 尝试从错误消息中提取重置时间
            const match = errorData.message.match(/reset at (.+?)\./i);
            if (match) {
                try {
                    resetTime = new Date(match[1]).getTime();
                } catch (e) {
                    // 解析失败，使用默认时间
                }
            }
        }
        
        this.rateLimitResetTime = resetTime;
        
        const resetDate = new Date(resetTime);
        const remainingMinutes = Math.ceil((resetTime - Date.now()) / 60000);
        
        console.error('GitHub API速率限制:', {
            message: errorData.message,
            重置时间: resetDate.toLocaleString(),
            剩余等待时间: `${remainingMinutes} 分钟`
        });
        
        this.showNotification(`GitHub API速率限制，请等待 ${remainingMinutes} 分钟后重试`, 'warning');
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
    
    // HTML转义，防止XSS攻击
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
            
            // 使用escapeHtml防止XSS，同时确保中文字符正确显示
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
            this.folderPasswords.set(folder.id, this.safeBtoa(password));
        }
        
        // 保存数据
        this.saveLocalData();
        
        // 添加到同步队列
        this.addToSyncQueue();
        
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
        const enteredPassword = this.safeBtoa(password);
        
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
        if (!this.memoGrid || !this.currentFolder) return;
        
        this.memoGrid.innerHTML = '';
        
        const folderMemos = this.memos.filter(memo => memo.folderId === this.currentFolder.id);
        
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
            
            // 截取内容预览
            const contentPreview = memo.content ? 
                memo.content.substring(0, 150).replace(/\n/g, ' ') + (memo.content.length > 150 ? '...' : '') : 
                '暂无内容';
            
            // 格式化日期
            const date = new Date(memo.updatedAt || memo.createdAt);
            const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString().slice(0, 5);
            
            // 使用escapeHtml防止XSS，确保中文字符正确显示
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
            
            // 绑定编辑事件
            const editBtn = memoEl.querySelector('.memo-edit-btn');
            editBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.editMemo(memo.id);
            });
            
            // 绑定删除事件
            const deleteBtn = memoEl.querySelector('.memo-delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteMemo(memo.id);
            });
            
            // 点击卡片主体编辑
            memoEl.addEventListener('click', (e) => {
                if (!e.target.closest('.memo-actions')) {
                    this.editMemo(memo.id);
                }
            });
            
            this.memoGrid.appendChild(memoEl);
        });
    }
    
    createMemo() {
        console.log('创建新备忘录...');
        if (!this.currentFolder) {
            alert('请先选择一个文件夹');
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
        
        this.memos.unshift(this.currentMemo);
        this.showEditor();
        this.updateEditor();
        this.memoTitle.focus();
    }
    
    editMemo(memoId) {
        const memo = this.memos.find(m => m.id === memoId);
        if (!memo) return;
        
        this.currentMemo = memo;
        this.showEditor();
        this.updateEditor();
        this.memoContent.focus();
    }
    
    updateEditor() {
        if (!this.currentMemo || !this.memoTitle || !this.memoContent) return;
        
        this.memoTitle.value = this.currentMemo.title || '';
        this.memoContent.value = this.currentMemo.content || '';
        this.updateEditorInfo();
    }
    
    updateEditorInfo() {
        if (!this.charCount || !this.lastModified) return;
        
        // 字符计数
        const content = this.memoContent ? this.memoContent.value : '';
        const title = this.memoTitle ? this.memoTitle.value : '';
        const totalChars = content.length + title.length;
        this.charCount.textContent = totalChars;
        
        // 最后修改时间
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
        if (!this.currentMemo) return;
        
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
        
        // 更新备忘录列表中的条目
        const memoIndex = this.memos.findIndex(m => m.id === this.currentMemo.id);
        if (memoIndex !== -1) {
            this.memos[memoIndex] = this.currentMemo;
        }
        
        // 保存数据
        this.saveLocalData();
        
        // 添加到同步队列
        this.addToSyncQueue();
        
        // 更新视图
        this.renderMemos();
        
        this.showNotification('备忘录已保存', 'success');
    }
    
    closeEditor() {
        if (this.currentMemo && 
            (this.memoTitle.value.trim() !== this.currentMemo.title || 
             this.memoContent.value.trim() !== this.currentMemo.content)) {
            
            if (confirm('备忘录有未保存的更改，确定要关闭吗？')) {
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
            this.confirmMessage.textContent = `确定要删除备忘录"${this.escapeHtml(memo.title)}"吗？此操作无法撤销。`;
        }
        
        this.showModal(this.confirmModal);
    }
    
    promptDeleteFolder(folderId) {
        const folder = folderId ? this.folders.find(f => f.id === folderId) : this.currentFolder;
        if (!folder) return;
        
        // 检查文件夹中是否有备忘录
        const folderMemos = this.memos.filter(memo => memo.folderId === folder.id);
        
        this.pendingDelete = {
            type: 'folder',
            id: folder.id
        };
        
        if (this.confirmMessage) {
            let message = `确定要删除文件夹"${this.escapeHtml(folder.name)}"吗？`;
            if (folderMemos.length > 0) {
                message += `\n文件夹中包含 ${folderMemos.length} 个备忘录，也将被删除。`;
            }
            message += '\n此操作无法撤销。';
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
            // 删除备忘录
            const memoIndex = this.memos.findIndex(m => m.id === this.pendingDelete.id);
            if (memoIndex !== -1) {
                this.memos.splice(memoIndex, 1);
                
                // 如果当前正在编辑这个备忘录，关闭编辑器
                if (this.currentMemo && this.currentMemo.id === this.pendingDelete.id) {
                    this.showMemoList();
                    this.currentMemo = null;
                }
                
                this.showNotification('备忘录已删除', 'success');
            }
        } else if (this.pendingDelete.type === 'folder') {
            // 删除文件夹及其所有备忘录
            const folderIndex = this.folders.findIndex(f => f.id === this.pendingDelete.id);
            if (folderIndex !== -1) {
                this.folders.splice(folderIndex, 1);
                
                // 删除文件夹中的所有备忘录
                this.memos = this.memos.filter(memo => memo.folderId !== this.pendingDelete.id);
                
                // 删除文件夹密码
                this.folderPasswords.delete(this.pendingDelete.id);
                
                // 如果当前正在查看这个文件夹，切换到文件夹列表
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
                
                this.showNotification('文件夹已删除', 'success');
            }
        }
        
        // 保存数据
        this.saveLocalData();
        
        // 添加到同步队列
        this.addToSyncQueue();
        
        // 更新视图
        this.renderFolders();
        this.renderMemos();
        
        // 重置删除状态
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
            app: 'GitHub Memo'
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
    
    saveLocalData() {
        const data = {
            folders: this.folders,
            memos: this.memos,
            passwords: Array.from(this.folderPasswords.entries()),
            version: ++this.dataVersion,
            lastModified: new Date().toISOString(),
            charset: 'UTF-8'
        };
        
        localStorage.setItem('memoLocalData', JSON.stringify(data));
        console.log('本地数据已保存，版本:', this.dataVersion);
    }
    
    showModal(modal) {
        if (!modal) return;
        
        modal.classList.remove('hidden');
        
        // 显示遮罩层
        if (this.modalOverlay) {
            this.modalOverlay.classList.remove('hidden');
        }
    }
    
    hideModal(modal) {
        if (!modal) return;
        
        modal.classList.add('hidden');
        
        // 隐藏遮罩层
        if (this.modalOverlay) {
            this.modalOverlay.classList.add('hidden');
        }
    }
    
    showNotification(message, type = 'info') {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        // 图标
        let icon = 'fas fa-info-circle';
        if (type === 'success') icon = 'fas fa-check-circle';
        if (type === 'error') icon = 'fas fa-exclamation-circle';
        if (type === 'warning') icon = 'fas fa-exclamation-triangle';
        
        notification.innerHTML = `
            <i class="${icon}"></i>
            <span>${this.escapeHtml(message)}</span>
            <button class="notification-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        // 添加到页面
        document.body.appendChild(notification);
        
        // 显示通知
        setTimeout(() => notification.classList.add('show'), 10);
        
        // 绑定关闭按钮
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        });
        
        // 自动关闭
        setTimeout(() => {
            if (notification.parentNode) {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }
        }, 3000);
    }
    
    startNetworkMonitoring() {
        window.addEventListener('online', () => {
            this.networkStatus = 'online';
            console.log('网络已连接');
            this.showNotification('网络已连接', 'success');
            
            // 网络恢复后尝试同步
            if (this.config.storageType === 'github') {
                this.syncFromGitHub().catch(console.error);
            }
        });
        
        window.addEventListener('offline', () => {
            this.networkStatus = 'offline';
            console.log('网络已断开');
            this.showNotification('网络已断开，进入离线模式', 'warning');
        });
    }
    
    startAutoSync() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
        }
        
        // 每5分钟自动同步一次
        this.autoSyncInterval = setInterval(() => {
            if (this.config.storageType === 'github' && this.networkStatus === 'online') {
                this.syncFromGitHub().catch(console.error);
            }
        }, 5 * 60 * 1000);
        
        console.log('自动同步已启动（每5分钟一次）');
    }
    
    updateLastSync() {
        if (!this.lastSync) return;
        
        const now = new Date();
        this.lastSync.textContent = now.toLocaleTimeString();
        this.lastSyncTime = now.getTime();
    }
    
    logDataStats() {
        console.log('数据统计:', {
            文件夹数量: this.folders.length,
            备忘录数量: this.memos.length,
            数据版本: this.dataVersion,
            设备ID: this.deviceId.substring(0, 8),
            存储模式: this.config.storageType
        });
    }
    
    addToSyncQueue() {
        // 简化实现：立即保存到GitHub（如果启用）
        if (this.config.storageType === 'github') {
            this.saveToGitHub().catch(console.error);
        }
    }
    
    async saveToGitHub() {
        if (this.config.storageType !== 'github' || !this.config.token || !this.config.username || !this.config.repo) {
            return;
        }
        
        if (this.syncing) {
            console.log('正在同步中，跳过');
            return;
        }
        
        this.syncing = true;
        
        try {
            // 准备数据
            const data = {
                folders: this.folders,
                memos: this.memos,
                passwords: Array.from(this.folderPasswords.entries()),
                version: this.dataVersion,
                lastModified: new Date().toISOString(),
                charset: 'UTF-8'
            };
            
            // 编码为Base64（使用安全编码支持中文）
            const jsonStr = JSON.stringify(data, null, 2);
            const content = this.encodeJSONForStorage(jsonStr);
            
            // GitHub API URL
            const apiUrl = `https://api.github.com/repos/${this.config.username}/${this.config.repo}/contents/data.json`;
            
            // 先获取文件的SHA（如果存在）
            let sha = null;
            try {
                const response = await fetch(apiUrl, {
                    headers: {
                        'Authorization': `token ${this.config.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                
                if (response.ok) {
                    const fileInfo = await response.json();
                    sha = fileInfo.sha;
                }
            } catch (error) {
                console.log('文件不存在或获取失败，将创建新文件');
            }
            
            // 提交到GitHub
            const commitData = {
                message: `更新备忘录数据 (v${this.dataVersion})`,
                content: content,
                ...(sha ? { sha } : {})
            };
            
            const response = await fetch(apiUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(commitData)
            });
            
            if (response.ok) {
                console.log('数据保存到GitHub成功');
                this.updateLastSync();
                this.showNotification('数据已同步到云端', 'success');
            } else {
                const error = await response.json();
                throw new Error(error.message || '保存失败');
            }
        } catch (error) {
            console.error('保存到GitHub失败:', error);
            this.showNotification('同步到云端失败', 'error');
        } finally {
            this.syncing = false;
        }
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    window.app = new GitHubMemo();
    window.app.init();
});
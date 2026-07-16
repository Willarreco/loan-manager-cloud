/* ============================================
   Gerenciador da API WhatsApp (PavTech WA)
   ============================================ */

const WA_API_BASE = 'https://wa-swagger.pavtech.com.br';

// Estado
let waSessions = [];
let waApiKey = localStorage.getItem('wa_api_key') || '';
let waPollInterval = null;

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    waApiKey = localStorage.getItem('wa_api_key') || '';
    if (document.getElementById('wa-api-key')) {
        document.getElementById('wa-api-key').value = waApiKey;
    }
});

function waGetHeaders() {
    return {
        'Content-Type': 'application/json',
        'X-API-Key': waApiKey
    };
}

function waSalvarApiKey() {
    waApiKey = document.getElementById('wa-api-key').value.trim();
    localStorage.setItem('wa_api_key', waApiKey);
    alert('API Key salva!');
}

async function waApiRequest(method, path, body = null) {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const baseUrl = isLocal ? WA_API_BASE : '/api/wa-proxy?path=';
    const fullPath = isLocal ? baseUrl + path : baseUrl + encodeURIComponent(path);

    const opts = {
        method,
        headers: waGetHeaders()
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(fullPath, opts);
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(res.status + (errText ? ': ' + errText.slice(0, 200) : ''));
    }
    if (res.status === 204) return null;
    return res.json();
}

// ========== SESSÕES ==========

async function waListarSessoes() {
    try {
        waSessions = await waApiRequest('GET', '/api/sessions');
        waRenderSessoes();
    } catch (e) {
        waRenderSessoes();
        document.getElementById('wa-sessions-error').textContent = 'Erro: ' + e.message;
    }
}

async function waCriarSessao() {
    const nome = document.getElementById('wa-session-name').value.trim();
    if (!nome) { alert('Digite um nome para a sessão.'); return; }
    try {
        await waApiRequest('POST', '/api/sessions', { name: nome });
        document.getElementById('wa-session-name').value = '';
        await waListarSessoes();
    } catch (e) {
        alert('Erro ao criar: ' + e.message);
    }
}

async function waIniciarSessao(id) {
    try {
        await waApiRequest('POST', '/api/sessions/' + id + '/start');
        await waListarSessoes();
    } catch (e) {
        alert('Erro ao iniciar: ' + e.message);
    }
}

async function waPararSessao(id) {
    try {
        await waApiRequest('POST', '/api/sessions/' + id + '/stop');
        await waListarSessoes();
    } catch (e) {
        alert('Erro ao parar: ' + e.message);
    }
}

async function waExcluirSessao(id) {
    if (!confirm('Excluir esta sessão permanentemente?')) return;
    try {
        await waApiRequest('DELETE', '/api/sessions/' + id);
        await waListarSessoes();
    } catch (e) {
        alert('Erro ao excluir: ' + e.message);
    }
}

async function waExibirQR(id) {
    const qrContainer = document.getElementById('wa-qr-container');
    const qrImg = document.getElementById('wa-qr-image');
    const qrStatus = document.getElementById('wa-qr-status');
    try {
        qrContainer.style.display = 'block';
        qrStatus.textContent = 'Obtendo QR code...';
        const data = await waApiRequest('GET', '/api/sessions/' + id + '/qr');
        qrImg.src = data.qrCode;
        qrStatus.textContent = 'Escaneie com WhatsApp > Menu > Dispositivos Conectados';
        qrContainer.dataset.sessionId = id;
    } catch (e) {
        qrImg.src = '';
        qrStatus.textContent = 'Erro: ' + e.message;
    }
}

function waFecharQR() {
    document.getElementById('wa-qr-container').style.display = 'none';
}

function waGetStatusText(status) {
    const map = {
        'created': 'Criada',
        'initializing': 'Inicializando',
        'qr_ready': 'QR Pronto',
        'authenticating': 'Autenticando',
        'ready': 'Conectado',
        'disconnected': 'Desconectado',
        'failed': 'Falhou'
    };
    return map[status] || status;
}

function waGetStatusClass(status) {
    const map = {
        'ready': 'status-ok',
        'created': 'status-warn',
        'initializing': 'status-warn',
        'qr_ready': 'status-warn',
        'authenticating': 'status-warn',
        'disconnected': 'status-overdue',
        'failed': 'status-overdue'
    };
    return map[status] || 'status-warn';
}

function waRenderSessoes() {
    const tbody = document.getElementById('wa-sessions-list');
    const empty = document.getElementById('wa-sessions-empty');
    const error = document.getElementById('wa-sessions-error');
    error.textContent = '';
    tbody.innerHTML = '';

    if (waSessions.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    waSessions.forEach(s => {
        const tr = document.createElement('tr');
        const statusClass = waGetStatusClass(s.status);
        const isReady = s.status === 'ready';
        const isDisconnected = s.status === 'disconnected' || s.status === 'created' || s.status === 'failed';
        tr.innerHTML = `
            <td><strong>${s.name}</strong></td>
            <td><span class="status-badge ${statusClass}">${waGetStatusText(s.status)}</span></td>
            <td>${s.phone ? s.phone : '—'}</td>
            <td>
                ${isReady ? `<button class="edit-btn" onclick="waPararSessao('${s.id}')">Parar</button>` : ''}
                ${isDisconnected ? `<button class="success-btn" onclick="waIniciarSessao('${s.id}')">Iniciar</button>` : ''}
                ${s.status === 'qr_ready' || isDisconnected ? `<button class="primary-btn" onclick="waExibirQR('${s.id}')">QR</button>` : ''}
                <button class="danger-btn" onclick="waExcluirSessao('${s.id}')">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ========== ENVIO DE MENSAGEM ==========

async function waEnviarMensagem() {
    const sessionId = document.getElementById('wa-send-session').value;
    const telefone = document.getElementById('wa-send-phone').value.replace(/\D/g, '');
    const texto = document.getElementById('wa-send-text').value.trim();
    const statusEl = document.getElementById('wa-send-status');

    if (!sessionId) { statusEl.textContent = 'Selecione uma sessão.'; return; }
    if (!telefone) { statusEl.textContent = 'Digite o telefone.'; return; }
    if (!texto) { statusEl.textContent = 'Digite a mensagem.'; return; }

    statusEl.textContent = 'Enviando...';
    try {
        const result = await waApiRequest('POST', '/api/sessions/' + sessionId + '/messages/send-text', {
            chatId: telefone + '@c.us',
            text: texto
        });
        statusEl.textContent = 'Enviado! ID: ' + (result.messageId || 'OK');
    } catch (e) {
        statusEl.textContent = 'Erro: ' + e.message;
    }
}

// ========== LOG DE NOTIFICAÇÕES ==========

async function waCarregarLog() {
    const supabase = window.supabaseClient;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    const { data, error } = await supabase
        .from('notificacao_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);

    const tbody = document.getElementById('wa-log-list');
    const empty = document.getElementById('wa-log-empty');
    tbody.innerHTML = '';

    if (error || !data || data.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    data.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${log.cliente_nome}</td>
            <td>${log.cliente_telefone}</td>
            <td>R$ ${parseFloat(log.parcela_valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td>${log.parcela_vencimento ? log.parcela_vencimento.split('-').reverse().join('/') : '—'}</td>
            <td><span class="status-badge status-ok">${log.status}</span></td>
            <td>${log.tipo_envio}</td>
            <td style="font-size: 0.75rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.mensagem || ''}">${(log.mensagem || '').slice(0, 50)}...</td>
            <td>${new Date(log.created_at).toLocaleString('pt-BR')}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ========== PREENCHER SELECT DE SESSÕES ==========

function waPreencherSelectSessoes() {
    const select = document.getElementById('wa-send-session');
    select.innerHTML = '<option value="">Selecione uma sessão...</option>';
    waSessions.filter(s => s.status === 'ready').forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name + (s.phone ? ' (' + s.phone + ')' : '');
        select.appendChild(opt);
    });
}

// ========== INICIAR POLLING ==========

function waIniciarPolling() {
    if (waPollInterval) clearInterval(waPollInterval);
    waPollInterval = setInterval(() => {
        if (waApiKey) {
            waListarSessoes();
            waPreencherSelectSessoes();
        }
    }, 10000);
}

// ========== NAVEGAÇÃO ==========

function waAbrirPainel() {
    document.getElementById('wa-panel').style.display = 'block';
    var form = document.querySelector('.form-container');
    var stats = document.querySelector('.dashboard-stats');
    var list = document.querySelector('.list-container');
    var reportBtn = document.getElementById('generate-report-btn');
    if (form) form.style.display = 'none';
    if (stats) stats.style.display = 'none';
    if (list) list.style.display = 'none';
    if (reportBtn) reportBtn.style.display = 'none';

    document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
    document.getElementById('btn-wa').classList.add('active');

    if (waPollInterval) clearInterval(waPollInterval);
    waListarSessoes();
    waPreencherSelectSessoes();
    waCarregarLog();
    waIniciarPolling();
}

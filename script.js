console.log('script.js carregou!');
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOMContentLoaded disparou!');
    const session = await checkSession();
    console.log('Session:', session ? 'OK' : 'null');
    if (!session) { console.log('Sem session, abortando'); return; }

    const supabase = window.supabaseClient;
    const user = session.user;

    // Toast Notifications
    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icons = { success: '✓', error: '✕', info: 'ℹ' };
        toast.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }
    window.showToast = showToast;

    function formatToIsoDate(val) {
        if (!val) return '';
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
            return s.split('T')[0].split(' ')[0];
        }
        const brMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (brMatch) {
            const dia = brMatch[1].padStart(2, '0');
            const mes = brMatch[2].padStart(2, '0');
            const ano = brMatch[3];
            return `${ano}-${mes}-${dia}`;
        }
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            return d.toISOString().split('T')[0];
        }
        return s;
    }
    window.formatToIsoDate = formatToIsoDate;

    const loanForm = {
        nome: document.getElementById('cliente-nome'),
        telefone: document.getElementById('cliente-telefone'),
        valor: document.getElementById('valor-pego'),
        juros: document.getElementById('valor-juros'),
        tipoJuros: document.getElementById('tipo-juros'),
        cobrado: document.getElementById('valor-cobrado'),
        data: document.getElementById('data-pagamento'),
        frequencia: document.getElementById('frequencia'),
        numeroParcelas: document.getElementById('numero-parcelas-input'),
        valorParcela: document.getElementById('valor-parcela-input'),
        observacao: document.getElementById('cliente-observacao')
    };
    const addBtn = document.getElementById('add-client-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const labelJuros = document.getElementById('label-juros');
    const labelDataPagamento = document.getElementById('label-data-pagamento');
    const labelValorPego = document.getElementById('label-valor-pego');
    const labelObservacao = document.getElementById('label-observacao');
    const frequenciaGroup = document.getElementById('frequencia-group');
    const valorCobradoGroup = document.getElementById('valor-cobrado-group');
    const acordoClienteExistenteGroup = document.getElementById('acordo-cliente-existente-group');
    const acordoClienteSelect = document.getElementById('acordo-cliente-select');
    const tabBtnNormal = document.getElementById('tab-btn-normal');
    const tabBtnAcordo = document.getElementById('tab-btn-acordo');
    const parcelasNumGroup = document.getElementById('parcelas-num-group');
    const loanList = document.getElementById('loan-list');
    const emptyState = document.getElementById('empty-state');
    const themeSelect = document.getElementById('theme-select');
    const reportBtn = document.getElementById('generate-report-btn');
    const alertsBar = document.getElementById('expiration-alerts');
    const parcelasGroup = document.getElementById('parcelas-group');

    const ADMIN_PHONE = '027997200333';

    let loans = [];
    let editingLoanId = null;
    let loanChart = null;
    let statusChart = null;
    let notificacoesExibidas = false;

    // Solicitar permissão de notificações
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    loadLoans().then(async () => {
        await cadastrarClientesReaisIniciais();
        await cadastrarRendasIniciais();
    });

    if (!addBtn) { console.error('Botao add-client-btn nao encontrado!'); } else { addBtn.addEventListener('click', addLoan); }
    themeSelect.addEventListener('change', toggleTheme);
    reportBtn.addEventListener('click', () => alert('Funcionalidade de Relatório PDF em desenvolvimento.'));

    const parcelasPreview = document.getElementById('parcelas-preview');
    const autoNotifyCheck = document.getElementById('auto-notify');
    const autoNotifyGroup = document.getElementById('auto-notify-group');
    const diaSemanaGroup = document.getElementById('dia-semana-group');
    const diaSemana = document.getElementById('dia-semana');
    const diaMesGroup = document.getElementById('dia-mes-group');
    const diaMes = document.getElementById('dia-mes');

    // Popular select dia do mês (1-31)
    for (let d = 1; d <= 31; d++) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = `Dia ${d}`;
        diaMes.appendChild(opt);
    }

    // Helper robusto para converter texto monetário (BR/US) em float
    function parseValorInput(val) {
        if (typeof val === 'number') return isNaN(val) ? 0 : val;
        if (val === null || val === undefined) return 0;
        let s = String(val).trim();
        if (!s) return 0;

        // Remove prefixo R$, espaços e caracteres não numéricos exceto , . e -
        s = s.replace(/R\$/gi, '').replace(/\s+/g, '');

        if (s.includes(',') && s.includes('.')) {
            if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
                // Formato brasileiro: 1.500,50 -> 1500.50
                s = s.replace(/\./g, '').replace(',', '.');
            } else {
                // Formato americano: 1,500.50 -> 1500.50
                s = s.replace(/,/g, '');
            }
        } else if (s.includes(',')) {
            // Apenas vírgula: "1500,50" -> "1500.50"
            s = s.replace(',', '.');
        } else if (s.includes('.')) {
            // Apenas ponto: pode ser milhar "2.000" ou decimal "2000.50"
            const parts = s.split('.');
            if (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1) {
                // Ex: "2.000", "1.500", "10.000" -> 2000, 1500, 10000
                s = s.replace('.', '');
            } else if (parts.length > 2) {
                // Ex: "1.000.000" -> 1000000
                s = s.replace(/\./g, '');
            }
        }

        const num = parseFloat(s);
        return isNaN(num) ? 0 : num;
    }

    // Helper para extrair número de parcelas (ex: "3", "3x", "4 parcelas")
    function parseParcelasInput(val) {
        if (typeof val === 'number') return isNaN(val) ? 1 : Math.max(1, Math.floor(val));
        if (!val) return 1;
        const digits = String(val).replace(/\D/g, '');
        const n = parseInt(digits, 10);
        return isNaN(n) || n <= 0 ? 1 : n;
    }

    let isUpdatingParcelas = false;
    let currentFormTab = 'normal';

    function alternarAbaFormulario(aba) {
        currentFormTab = aba;
        if (aba === 'acordo') {
            if (tabBtnAcordo) tabBtnAcordo.classList.add('active');
            if (tabBtnNormal) tabBtnNormal.classList.remove('active');
            if (acordoClienteExistenteGroup) acordoClienteExistenteGroup.style.display = 'block';
            if (labelValorPego) labelValorPego.textContent = 'Valor Total do Acordo (R$):';
            if (labelObservacao) {
                labelObservacao.innerHTML = '<i class="fas fa-file-signature" style="color:var(--accent-purple);"></i> Texto do Acordo (para você lembrar dos termos e combinados):';
                labelObservacao.style.color = '#c4b5fd';
            }
            if (loanForm.observacao) {
                loanForm.observacao.placeholder = 'Digite aqui o que foi combinado com o cliente. Ex: Acordo fechado: cliente tinha dívida em aberto de R$ 1.200 e acertou pagar em 4x de R$ 300 sem juros todo dia 10.';
                loanForm.observacao.style.borderColor = 'rgba(139, 92, 246, 0.5)';
            }
            if (frequenciaGroup) frequenciaGroup.style.display = 'none';
            if (valorCobradoGroup) valorCobradoGroup.style.display = 'none';
            if (loanForm.frequencia) {
                loanForm.frequencia.value = 'parcelado';
                loanForm.frequencia.dispatchEvent(new Event('change'));
            }
            if (loanForm.numeroParcelas && !loanForm.numeroParcelas.value) {
                loanForm.numeroParcelas.value = '3';
            }
            if (loanForm.juros && !loanForm.juros.value) {
                loanForm.juros.value = '0';
            }
            if (addBtn && !editingLoanId) {
                addBtn.innerHTML = '<i class="fas fa-handshake"></i> Salvar Acordo';
                addBtn.style.background = 'linear-gradient(135deg, #8b5cf6, #6d28d9)';
            }
            atualizarSelectClientesAcordo();
        } else {
            if (tabBtnNormal) tabBtnNormal.classList.add('active');
            if (tabBtnAcordo) tabBtnAcordo.classList.remove('active');
            if (acordoClienteExistenteGroup) acordoClienteExistenteGroup.style.display = 'none';
            if (frequenciaGroup) frequenciaGroup.style.display = 'block';
            if (valorCobradoGroup) valorCobradoGroup.style.display = 'block';
            if (labelValorPego) labelValorPego.textContent = 'Valor Pego (R$):';
            if (labelObservacao) {
                labelObservacao.innerHTML = '<i class="fas fa-sticky-note" style="color:var(--text-secondary);"></i> Observação / Anotação (Opcional):';
                labelObservacao.style.color = 'var(--text-secondary)';
            }
            if (loanForm.observacao) {
                loanForm.observacao.placeholder = 'Anotação opcional sobre o empréstimo';
                loanForm.observacao.style.borderColor = 'var(--border-color)';
            }
            if (loanForm.frequencia && loanForm.frequencia.value === 'parcelado') {
                loanForm.frequencia.value = 'unique';
                loanForm.frequencia.dispatchEvent(new Event('change'));
            }
            if (addBtn && !editingLoanId) {
                addBtn.innerHTML = 'Adicionar Novo Cliente';
                addBtn.style.background = '';
            }
        }
        atualizarPreviewParcelas();
    }
    window.alternarAbaFormulario = alternarAbaFormulario;

    function atualizarSelectClientesAcordo() {
        if (!acordoClienteSelect) return;
        const valAtual = acordoClienteSelect.value;
        acordoClienteSelect.innerHTML = '<option value="">-- Cadastrar Novo Acordo / Cliente Avulso --</option>';
        loans.forEach(l => {
            let saldo = l.totalAPagar;
            if (l.frequencia !== 'unique' && l.pagamentos && l.pagamentos.length > 0) {
                const pendentes = l.pagamentos.filter(p => !p.pago);
                if (pendentes.length > 0) {
                    saldo = pendentes.reduce((acc, p) => acc + p.valor, 0);
                }
            } else if (l.pago) {
                saldo = 0;
            }
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = `${l.nome} - Saldo: R$ ${saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            acordoClienteSelect.appendChild(opt);
        });
        acordoClienteSelect.value = valAtual || '';
    }

    if (acordoClienteSelect) {
        acordoClienteSelect.addEventListener('change', () => {
            const id = acordoClienteSelect.value;
            if (!id) {
                editingLoanId = null;
                if (cancelEditBtn) cancelEditBtn.style.display = 'none';
                if (addBtn) {
                    addBtn.innerHTML = '<i class="fas fa-handshake"></i> Salvar Acordo';
                    addBtn.style.background = 'linear-gradient(135deg, #8b5cf6, #6d28d9)';
                }
                return;
            }
            const l = loans.find(x => x.id == id);
            if (!l) return;
            loanForm.nome.value = l.nome;
            loanForm.telefone.value = l.telefone;
            let saldo = l.totalAPagar;
            if (l.frequencia !== 'unique' && l.pagamentos && l.pagamentos.length > 0) {
                const pendentes = l.pagamentos.filter(p => !p.pago);
                if (pendentes.length > 0) {
                    saldo = pendentes.reduce((acc, p) => acc + p.valor, 0);
                }
            } else if (l.pago) {
                saldo = 0;
            }
            loanForm.valor.value = saldo > 0 ? saldo.toFixed(2) : l.valor.toFixed(2);
            loanForm.juros.value = '0';
            loanForm.cobrado.value = '';
            if (loanForm.numeroParcelas && (!loanForm.numeroParcelas.value || loanForm.numeroParcelas.value === '')) {
                loanForm.numeroParcelas.value = '3';
            }
            if (loanForm.observacao) {
                loanForm.observacao.value = l.observacao || '';
            }
            editingLoanId = l.id;
            if (cancelEditBtn) cancelEditBtn.style.display = 'inline-block';
            if (addBtn) {
                addBtn.innerHTML = '<i class="fas fa-check"></i> Salvar Acordo de ' + l.nome.split(' ')[0];
                addBtn.style.background = 'linear-gradient(135deg, #8b5cf6, #6d28d9)';
            }
            atualizarPreviewParcelas('num');
        });
    }

    function atualizarPreviewParcelas(origem = '') {
        const valor = parseValorInput(loanForm.valor.value);
        const juros = parseValorInput(loanForm.juros.value);
        const tipoJuros = loanForm.tipoJuros.value;
        const cobrado = parseValorInput(loanForm.cobrado.value);
        const freq = loanForm.frequencia.value;
        const valorJuros = tipoJuros === 'percent' ? (valor * (juros / 100)) : juros;
        const total = valor + valorJuros + cobrado;

        const isParceladoType = freq === 'parcelado' || freq === 'weekly' || freq === 'monthly' || freq === 'juros_only';

        if (!isParceladoType || total <= 0) {
            parcelasPreview.textContent = '';
            return;
        }

        let numParcelas = loanForm.numeroParcelas ? parseParcelasInput(loanForm.numeroParcelas.value) : 0;
        let valorParcela = parseValorInput(loanForm.valorParcela.value);

        if (!isUpdatingParcelas) {
            isUpdatingParcelas = true;
            if (origem === 'num' && numParcelas > 0) {
                valorParcela = Math.round((total / numParcelas) * 100) / 100;
                loanForm.valorParcela.value = valorParcela > 0 ? valorParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
            } else if (origem === 'val' && valorParcela > 0) {
                numParcelas = Math.ceil(total / valorParcela);
                if (loanForm.numeroParcelas) loanForm.numeroParcelas.value = numParcelas;
            } else if (!origem) {
                if (numParcelas > 0) {
                    valorParcela = Math.round((total / numParcelas) * 100) / 100;
                    loanForm.valorParcela.value = valorParcela > 0 ? valorParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
                } else if (valorParcela > 0) {
                    numParcelas = Math.ceil(total / valorParcela);
                    if (loanForm.numeroParcelas) loanForm.numeroParcelas.value = numParcelas;
                }
            }
            isUpdatingParcelas = false;
        }

        if (numParcelas > 0 && valorParcela > 0) {
            let diaInfo = '';
            if (freq === 'weekly' || freq === 'juros_only') {
                const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
                diaInfo = ` todo(a) ${dias[parseInt(diaSemana.value)]}`;
            } else if (freq === 'parcelado') {
                const dataVal = loanForm.data.value;
                if (dataVal) {
                    const diaP = parseInt(dataVal.split('-')[2]) || 1;
                    diaInfo = ` todo dia ${diaP} (início: ${formatDate(dataVal)})`;
                } else {
                    diaInfo = ` todo mês`;
                }
            } else {
                diaInfo = ` todo dia ${diaMes.value}`;
            }

            const prefixo = freq === 'juros_only' ? 'Juros: ' : '';
            const freqLabel = (freq === 'weekly' || freq === 'juros_only') ? (numParcelas === 1 ? 'semana' : 'semanas') : (numParcelas === 1 ? 'mês' : 'meses');
            parcelasPreview.textContent = `${prefixo}${numParcelas}x de R$ ${valorParcela.toFixed(2)} (${freqLabel}${diaInfo}) = Total: R$ ${total.toFixed(2)}`;
        } else {
            parcelasPreview.textContent = '';
        }
    }

    // Mostrar/esconder campos conforme frequência
    loanForm.frequencia.addEventListener('change', () => {
        const freq = loanForm.frequencia.value;
        const isParceladoType = freq === 'parcelado' || freq === 'weekly' || freq === 'monthly' || freq === 'juros_only';

        if (autoNotifyGroup) autoNotifyGroup.style.display = isParceladoType ? 'block' : 'none';
        if (parcelasGroup) parcelasGroup.style.display = isParceladoType ? 'block' : 'none';
        if (parcelasNumGroup) parcelasNumGroup.style.display = isParceladoType ? 'block' : 'none';
        if (diaSemanaGroup) diaSemanaGroup.style.display = (freq === 'weekly' || freq === 'juros_only') ? 'block' : 'none';
        if (diaMesGroup) diaMesGroup.style.display = freq === 'monthly' ? 'block' : 'none';

        if (labelJuros) labelJuros.innerHTML = 'Juros <span style="font-size:0.8rem;color:var(--text-secondary);font-weight:normal;">(Opcional)</span>:';
        loanForm.juros.placeholder = '0 (opcional)';

        if (freq === 'parcelado') {
            if (labelDataPagamento) labelDataPagamento.textContent = 'Data do 1º Vencimento:';
            if (autoNotifyCheck) autoNotifyCheck.checked = true;
            if (loanForm.numeroParcelas && !loanForm.numeroParcelas.value) loanForm.numeroParcelas.value = '3';
        } else {
            if (labelDataPagamento) labelDataPagamento.textContent = 'Data de Pagamento:';
        }

        if (freq === 'unique') {
            loanForm.valorParcela.value = '';
            if (loanForm.numeroParcelas) loanForm.numeroParcelas.value = '';
            parcelasPreview.textContent = '';
        }
        atualizarPreviewParcelas();
    });

    loanForm.valor.addEventListener('input', () => atualizarPreviewParcelas());
    loanForm.juros.addEventListener('input', () => atualizarPreviewParcelas());
    loanForm.tipoJuros.addEventListener('change', () => atualizarPreviewParcelas());
    loanForm.cobrado.addEventListener('input', () => atualizarPreviewParcelas());
    if (loanForm.numeroParcelas) {
        loanForm.numeroParcelas.addEventListener('input', () => atualizarPreviewParcelas('num'));
    }
    loanForm.valorParcela.addEventListener('input', () => atualizarPreviewParcelas('val'));
    loanForm.data.addEventListener('change', () => atualizarPreviewParcelas());
    diaSemana.addEventListener('change', () => atualizarPreviewParcelas());
    diaMes.addEventListener('change', () => atualizarPreviewParcelas());

    // Verificações automáticas a cada 60 segundos
    setInterval(() => {
        checkExpirations();
        checkAutomaticNotifications();
    }, 60000);

    async function loadLoans() {
        const { data, error } = await supabase
            .from('loans')
            .select('*')
            .order('data_pagamento', { ascending: true });

        if (error) {
            console.error('Erro ao carregar empréstimos:', error.message);
        } else {
            loans = data.map(l => ({
                id: l.id,
                nome: l.nome,
                telefone: l.telefone,
                valor: parseFloat(l.valor),
                juros: parseFloat(l.juros || 0),
                tipoJuros: l.tipo_juros || 'percent',
                cobrado: parseFloat(l.valor_cobrado || 0),
                totalAPagar: parseFloat(l.total_a_pagar),
                data: formatToIsoDate(l.data_pagamento),
                frequencia: l.frequencia || 'unique',
                numeroParcelas: l.numero_parcelas || null,
                valorParcela: l.valor_parcela ? parseFloat(l.valor_parcela) : null,
                diaVencimento: l.dia_vencimento,
                autoNotify: l.auto_notify || false,
                pago: l.pago || localStorage.getItem('loan_pago_' + l.id) === 'true' || false,
                observacao: l.observacao || localStorage.getItem('loan_obs_' + l.id) || ''
            }));
            // Carregar pagamentos para todos os empréstimos
            await loadAllPagamentos();
            renderLoans();
            atualizarSelectClientesAcordo();
            checkExpirations();
            checkAutomaticNotifications();
        }
    }

    async function cadastrarClientesReaisIniciais() {
        const jaCadastrado = localStorage.getItem('clientes_reais_importados_v1');
        if (jaCadastrado) return;

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // 1. Remover cadastros de teste
            const { data: existentes } = await supabase.from('loans').select('id, nome');
            if (existentes && existentes.length > 0) {
                const testes = existentes.filter(l => l.nome && (l.nome.toLowerCase().includes('teste') || l.nome.toLowerCase().includes('acordo teste')));
                for (const t of testes) {
                    await supabase.from('pagamentos').delete().eq('loan_id', t.id);
                    await supabase.from('loans').delete().eq('id', t.id);
                }
            }

            // 2. Lista dos 17 clientes solicitados pelo usuário
            const novosClientes = [
                { nome: 'Emerson Bruno', telefone: '27 99955-7504', valor: 2000.00, juros: 500.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 2500.00, data_pagamento: '2026-09-15', frequencia: 'unique' },
                { nome: 'Kezia mulher do Cleverson', telefone: '27 99519-0825', valor: 500.00, juros: 200.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 700.00, data_pagamento: '2026-10-27', frequencia: 'unique' },
                { nome: 'Anselmo Mota', telefone: '27997200333', valor: 2374.78, juros: 12.00, tipo_juros: 'percent', valor_cobrado: 0, total_a_pagar: 2659.75, data_pagamento: '2026-10-30', frequencia: 'unique' },
                { nome: 'Cleverson barbeiro', telefone: '27 99502-3458', valor: 4000.00, juros: 1200.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 5200.00, data_pagamento: '2026-10-31', frequencia: 'unique' },
                { nome: 'Saulo Técnico', telefone: '27 99994-6731', valor: 2000.00, juros: 15.00, tipo_juros: 'percent', valor_cobrado: 0, total_a_pagar: 2300.00, data_pagamento: '2026-10-31', frequencia: 'unique' },
                { nome: 'Saulo técnico', telefone: '27 99994-6731', valor: 1000.00, juros: 200.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 1200.00, data_pagamento: '2026-10-31', frequencia: 'unique' },
                { nome: 'Jackson Barbosa', telefone: '27 98823-1088', valor: 1500.00, juros: 10.00, tipo_juros: 'percent', valor_cobrado: 0, total_a_pagar: 1650.00, data_pagamento: '2026-10-31', frequencia: 'unique' },
                { nome: 'Cleverson', telefone: '27 99519-0825', valor: 500.00, juros: 225.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 725.00, data_pagamento: '2026-10-31', frequencia: 'unique' },
                { nome: 'Saulo Técnico', telefone: '27 99994-6731', valor: 1500.00, juros: 250.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 1750.00, data_pagamento: '2026-10-31', frequencia: 'unique' },
                { nome: 'Thiago Brito', telefone: '27996443368', valor: 1000.00, juros: 100.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 1100.00, data_pagamento: '2026-11-07', frequencia: 'unique' },
                { nome: 'JOÃO VICTOR', telefone: '27 99643-4574', valor: 2440.00, juros: 580.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 3020.00, data_pagamento: '2026-11-07', frequencia: 'unique' },
                { nome: 'Eric Furtado', telefone: '27 99707-6651', valor: 600.00, juros: 200.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 800.00, data_pagamento: '2026-11-07', frequencia: 'unique' },
                { nome: 'GEZIANNA', telefone: '27 99950-8501', valor: 3000.00, juros: 15.00, tipo_juros: 'percent', valor_cobrado: 0, total_a_pagar: 3450.00, data_pagamento: '2026-11-10', frequencia: 'unique' },
                { nome: 'THIAGO BRITO', telefone: '27 99570-7968', valor: 1500.00, juros: 200.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 1700.00, data_pagamento: '2026-11-10', frequencia: 'unique' },
                { nome: 'SOGRO DO CLEVERSON', telefone: '27 99519-0825', valor: 500.00, juros: 200.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 700.00, data_pagamento: '2026-11-15', frequencia: 'unique' },
                { nome: 'CLEVERSON', telefone: '27 99519-0825', valor: 500.00, juros: 200.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 700.00, data_pagamento: '2026-11-16', frequencia: 'unique' },
                { nome: 'Cleverson Barbairo', telefone: '27 99502-3458', valor: 500.00, juros: 200.00, tipo_juros: 'fixed', valor_cobrado: 0, total_a_pagar: 700.00, data_pagamento: '2026-11-23', frequencia: 'unique' }
            ];

            const { data: atuais } = await supabase.from('loans').select('nome, data_pagamento, valor');
            const atuaisList = atuais || [];

            for (const item of novosClientes) {
                const jaExiste = atuaisList.some(a => a.nome && a.nome.toLowerCase().trim() === item.nome.toLowerCase().trim());
                if (!jaExiste) {
                    await supabase.from('loans').insert([{
                        user_id: user.id,
                        nome: item.nome,
                        telefone: item.telefone,
                        valor: item.valor,
                        juros: item.juros,
                        tipo_juros: item.tipo_juros,
                        valor_cobrado: item.valor_cobrado,
                        total_a_pagar: item.total_a_pagar,
                        data_pagamento: item.data_pagamento,
                        frequencia: item.frequencia,
                        numero_parcelas: null,
                        valor_parcela: null,
                        auto_notify: false
                    }]);
                }
            }

            localStorage.setItem('clientes_reais_importados_v1', 'true');
            await loadLoans();
            showToast('Clientes cadastrados e cadastros de teste removidos com sucesso!');
        } catch (err) {
            console.error('Erro ao cadastrar clientes iniciais:', err);
        }
    }
    window.cadastrarClientesReaisIniciais = cadastrarClientesReaisIniciais;

    async function cadastrarRendasIniciais() {
        const jaCadastrado = localStorage.getItem('rendas_iniciais_importadas_v1');
        if (jaCadastrado) return;

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const novasRendas = [
                { nome: 'Beto Açougue', valor: 1200.00, data_renda: '2026-10-15', tipo: 'fixa', recorrente: true, observacao: '' },
                { nome: 'Bodinho', valor: 4500.00, data_renda: '2026-08-10', tipo: 'fixa', recorrente: true, observacao: '' },
                { nome: 'Condonal', valor: 2500.00, data_renda: '2026-08-07', tipo: 'fixa', recorrente: true, observacao: '' },
                { nome: 'Astran', valor: 6776.00, data_renda: '2026-07-31', tipo: 'fixa', recorrente: true, observacao: '' }
            ];

            const { data: atuais, error } = await supabase.from('rendas').select('nome, data_renda, valor');
            
            if (error) {
                console.warn('Tabela rendas não encontrada no Supabase, salvando em localStorage:', error.message);
                const local = JSON.parse(localStorage.getItem('local_rendas') || '[]');
                novasRendas.forEach((item, idx) => {
                    if (!local.some(l => l.nome === item.nome)) {
                        local.push({ id: 'local_' + Date.now() + '_' + idx, ...item, data: item.data_renda });
                    }
                });
                localStorage.setItem('local_rendas', JSON.stringify(local));
            } else {
                const atuaisList = atuais || [];
                for (const item of novasRendas) {
                    const jaExiste = atuaisList.some(a => a.nome === item.nome && a.data_renda === item.data_renda && parseFloat(a.valor) === item.valor);
                    if (!jaExiste) {
                        await supabase.from('rendas').insert([{
                            user_id: user.id,
                            nome: item.nome,
                            valor: item.valor,
                            data_renda: item.data_renda,
                            tipo: item.tipo,
                            recorrente: item.recorrente,
                            observacao: item.observacao
                        }]);
                    }
                }
            }

            localStorage.setItem('rendas_iniciais_importadas_v1', 'true');
            if (typeof loadRendas === 'function') {
                await loadRendas();
            }
            showToast('Rendas cadastradas com sucesso!');
        } catch (err) {
            console.error('Erro ao cadastrar rendas iniciais:', err);
        }
    }
    window.cadastrarRendasIniciais = cadastrarRendasIniciais;

    async function loadAllPagamentos() {
        if (loans.length === 0) return;
        try {
            const loanIds = loans.map(l => l.id);
            const { data, error } = await supabase
                .from('pagamentos')
                .select('*')
                .in('loan_id', loanIds)
                .order('data_vencimento', { ascending: true });

            if (error) {
                console.warn('Tabela pagamentos indisponível (ignore se não criou ainda):', error.message);
                return;
            }

            const pagamentosMap = {};
            (data || []).forEach(p => {
                if (!pagamentosMap[p.loan_id]) pagamentosMap[p.loan_id] = [];
                pagamentosMap[p.loan_id].push({
                    id: p.id,
                    loanId: p.loan_id,
                    dataVencimento: p.data_vencimento,
                    valor: parseFloat(p.valor),
                    pago: p.pago,
                    dataPagamento: p.data_pagamento,
                    tipo: p.tipo || 'juros',
                    whatsappEnviado: p.whatsapp_enviado || false
                });
            });

            loans.forEach(loan => {
                loan.pagamentos = pagamentosMap[loan.id] || [];
            });
        } catch (e) {
            console.warn('Erro ao carregar pagamentos:', e.message);
        }
    }

    async function addLoan() {
        try {
            const existingLoan = editingLoanId ? loans.find(l => l.id == editingLoanId) : null;

            const rawNome = loanForm.nome.value.trim();
            const rawTelefone = loanForm.telefone.value.trim();
            let rawValor = parseValorInput(loanForm.valor.value);
            let rawJuros = parseValorInput(loanForm.juros.value);
            const tipoJuros = loanForm.tipoJuros.value || 'percent';
            const cobrado = parseValorInput(loanForm.cobrado.value) || 0;
            let rawData = loanForm.data.value;
            const frequencia = loanForm.frequencia.value || 'unique';
            const observacao = loanForm.observacao ? loanForm.observacao.value.trim() : '';

            // Se valor <= 0 mas preencheu parcela e número de parcelas
            let numPre = loanForm.numeroParcelas ? parseParcelasInput(loanForm.numeroParcelas.value) : 0;
            let valPre = parseValorInput(loanForm.valorParcela.value);
            if (rawValor <= 0 && valPre > 0 && numPre > 0) {
                rawValor = Math.round(valPre * numPre * 100) / 100;
                loanForm.valor.value = rawValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            }

            // NENHUM CAMPO É OBRIGATÓRIO - Preenchimento inteligente e flexível:
            // 1. Nome: se não preenchido na edição mantém o anterior; se novo cadastro, define como "Cliente"
            let nome = rawNome;
            if (!nome) {
                nome = existingLoan ? existingLoan.nome : 'Cliente';
            }

            // 2. Telefone: se não preenchido na edição mantém o anterior; se novo cadastro, fica vazio
            let telefone = rawTelefone;
            if (!telefone && existingLoan) {
                telefone = existingLoan.telefone || '';
            }

            // 3. Valor: se não preenchido na edição mantém o anterior; se novo cadastro, fica 0
            let valor = rawValor;
            if (isNaN(valor) || valor < 0) valor = 0;
            if (valor === 0 && existingLoan && !loanForm.valor.value.trim()) {
                valor = existingLoan.valor || 0;
            }

            // 4. Data: se não preenchida na edição mantém a anterior; se novo cadastro, preenche hoje (ou +30 dias se acordo)
            let data = formatToIsoDate(rawData);
            if (!data) {
                if (existingLoan && existingLoan.data) {
                    data = formatToIsoDate(existingLoan.data);
                } else if (frequencia === 'parcelado' || currentFormTab === 'acordo') {
                    const proximoMes = new Date();
                    proximoMes.setDate(proximoMes.getDate() + 30);
                    data = proximoMes.toISOString().split('T')[0];
                } else {
                    data = new Date().toISOString().split('T')[0];
                }
            }
            loanForm.data.value = data;

            // 5. Juros: padrão 0 se não preenchido
            const juros = isNaN(rawJuros) || rawJuros < 0 ? 0 : rawJuros;

            const valorJuros = tipoJuros === 'percent' ? (valor * (juros / 100)) : juros;
            const totalAPagar = valor + valorJuros + cobrado;

            let numParcelas = null;
            let valParcela = null;
            let diaVencto = null;
            const isParcelado = frequencia === 'parcelado' || frequencia === 'weekly' || frequencia === 'monthly' || frequencia === 'juros_only';

            if (isParcelado) {
                let num = loanForm.numeroParcelas ? parseParcelasInput(loanForm.numeroParcelas.value) : 0;
                let val = parseValorInput(loanForm.valorParcela.value);

                if ((!num || num <= 0) && (!val || val <= 0)) {
                    if (existingLoan && existingLoan.numeroParcelas) {
                        num = existingLoan.numeroParcelas;
                        val = existingLoan.valorParcela || (totalAPagar / num);
                    } else {
                        num = 1;
                        val = totalAPagar;
                    }
                } else if (num > 0 && (!val || val <= 0)) {
                    val = Math.round((totalAPagar / num) * 100) / 100;
                } else if (val > 0 && (!num || num <= 0)) {
                    num = totalAPagar > 0 ? Math.ceil(totalAPagar / val) : 1;
                }

                numParcelas = num > 0 ? num : 1;
                valParcela = val >= 0 ? val : totalAPagar;

                if (frequencia === 'weekly' || frequencia === 'juros_only') {
                    diaVencto = parseInt(diaSemana.value) || 0;
                } else {
                    const diaP = parseInt(data.split('-')[2]) || 1;
                    diaVencto = diaP;
                }
            }

            const autoNotify = isParcelado ? (autoNotifyCheck ? autoNotifyCheck.checked : true) : false;
            const payload = {
                user_id: user.id, nome, telefone, valor, juros,
                tipo_juros: tipoJuros, valor_cobrado: cobrado,
                total_a_pagar: totalAPagar, data_pagamento: data,
                frequencia, numero_parcelas: numParcelas,
                valor_parcela: valParcela,
                auto_notify: autoNotify,
                observacao: observacao
            };
            if (diaVencto !== null) payload.dia_vencimento = diaVencto;

            let savedLoanId = editingLoanId;

            if (editingLoanId) {
                let updateRes = await supabase.from('loans').update(payload).eq('id', editingLoanId);

                // Fallback resiliente caso alguma coluna não exista na tabela loans do Supabase
                while (updateRes.error && updateRes.error.message) {
                    const msg = updateRes.error.message;
                    const matchCol = msg.match(/Could not find the '([^']+)' column/i);
                    if (matchCol && matchCol[1]) {
                        const colInvalida = matchCol[1];
                        console.warn(`Coluna '${colInvalida}' ausente em loans, removendo do payload e tentando novamente.`);
                        delete payload[colInvalida];
                        if (colInvalida === 'observacao' && observacao) {
                            localStorage.setItem('loan_obs_' + editingLoanId, observacao);
                        }
                        updateRes = await supabase.from('loans').update(payload).eq('id', editingLoanId);
                    } else if (msg.includes('observacao')) {
                        delete payload.observacao;
                        localStorage.setItem('loan_obs_' + editingLoanId, observacao);
                        updateRes = await supabase.from('loans').update(payload).eq('id', editingLoanId);
                    } else {
                        break;
                    }
                }

                if (updateRes.error) {
                    alert('Erro ao atualizar: ' + updateRes.error.message);
                    return;
                }

                if (observacao) {
                    localStorage.setItem('loan_obs_' + editingLoanId, observacao);
                }

                if (frequencia !== 'unique' && numParcelas) {
                    await deletePagamentosDoLoan(editingLoanId);
                    await gerarParcelas(editingLoanId, valParcela, numParcelas, frequencia, totalAPagar, valorJuros, data);
                } else if (frequencia === 'unique') {
                    await deletePagamentosDoLoan(editingLoanId);
                }

                // Atualizar estado em memória imediatamente (otimista)
                const loanIndex = loans.findIndex(l => String(l.id) === String(editingLoanId));
                if (loanIndex !== -1) {
                    loans[loanIndex] = {
                        ...loans[loanIndex],
                        nome,
                        telefone,
                        valor,
                        juros,
                        tipoJuros,
                        cobrado,
                        totalAPagar,
                        data,
                        frequencia,
                        numeroParcelas: numParcelas,
                        valorParcela: valParcela,
                        observacao
                    };
                }
                renderLoans();
                atualizarSelectClientesAcordo();
                checkExpirations();

                showToast('Empréstimo atualizado com sucesso!');
            } else {
                let insertRes = await supabase.from('loans').insert([payload]).select();
                if (insertRes.error && insertRes.error.message && insertRes.error.message.includes('observacao')) {
                    delete payload.observacao;
                    insertRes = await supabase.from('loans').insert([payload]).select();
                }
                if (insertRes.error) { alert('Erro ao salvar: ' + insertRes.error.message); return; }
                if (!insertRes.data || insertRes.data.length === 0) { alert('Erro: banco não retornou dados.'); return; }
                
                savedLoanId = insertRes.data[0].id;
                if (observacao) {
                    localStorage.setItem('loan_obs_' + savedLoanId, observacao);
                }

                if (frequencia !== 'unique' && numParcelas) {
                    await gerarParcelas(savedLoanId, valParcela, numParcelas, frequencia, totalAPagar, valorJuros, data);
                }
                showToast(frequencia === 'parcelado' ? 'Acordo/Parcelamento registrado com sucesso!' : 'Novo empréstimo adicionado!');
            }

            clearForm();
            loadLoans();
        } catch (e) {
            alert('Erro inesperado: ' + e.message);
            console.error(e);
        }
    }

    function calcularDataParcelaMensal(dataBaseStr, i) {
        const [ano, mes, dia] = dataBaseStr.split('-').map(Number);
        const targetMonth = (mes - 1) + i;
        const targetYear = ano + Math.floor(targetMonth / 12);
        const normalizedMonth = ((targetMonth % 12) + 12) % 12;
        const daysInMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
        const finalDay = Math.min(dia, daysInMonth);
        return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
    }

    async function gerarParcelas(loanId, valParcela, totalParcelas, frequencia, totalAPagar, valorJuros, dataInicial) {
        try {
            const parcelas = [];
            const hojeStr = new Date().toISOString().split('T')[0];
            const dataBase = dataInicial || hojeStr;
            const valorJurosParcela = valorJuros / totalParcelas;

            for (let i = 0; i < totalParcelas; i++) {
                let dataVencStr = '';

                if (frequencia === 'weekly' || frequencia === 'juros_only') {
                    const dataP = new Date(dataBase + 'T12:00:00');
                    const diaSemanaIdx = parseInt(diaSemana.value) || 0;
                    const diff = diaSemanaIdx - dataP.getDay();
                    dataP.setDate(dataP.getDate() + diff + (i * 7));
                    dataVencStr = dataP.toISOString().split('T')[0];
                } else {
                    // Parcelado ou Mensal: data inicial exata e repete todo mês
                    dataVencStr = calcularDataParcelaMensal(dataBase, i);
                }

                if (frequencia === 'juros_only') {
                    const valor = (i === totalParcelas - 1)
                        ? Math.round((valorJuros - (valorJurosParcela * (totalParcelas - 1))) * 100) / 100
                        : Math.round(valorJurosParcela * 100) / 100;
                    parcelas.push({
                        loan_id: loanId,
                        data_vencimento: dataVencStr,
                        valor,
                        pago: false,
                        tipo: 'juros'
                    });
                } else {
                    const ultimaParcela = Math.round((totalAPagar - (valParcela * (totalParcelas - 1))) * 100) / 100;
                    const valor = (i === totalParcelas - 1) ? ultimaParcela : valParcela;
                    parcelas.push({
                        loan_id: loanId,
                        data_vencimento: dataVencStr,
                        valor: Math.round(valor * 100) / 100,
                        pago: false,
                        tipo: 'parcela'
                    });
                }
            }

            // Para juros_only, adicionar parcela do principal
            if (frequencia === 'juros_only') {
                parcelas.push({
                    loan_id: loanId,
                    data_vencimento: dataBase,
                    valor: totalAPagar - valorJuros,
                    pago: false,
                    tipo: 'principal'
                });
            }

            const { error } = await supabase.from('pagamentos').insert(parcelas);
            if (error) {
                console.warn('Erro ao gerar parcelas:', error.message);
                alert('Execute o SQL da tabela pagamentos no Supabase primeiro!');
            }
        } catch (e) {
            console.warn('Erro ao gerar parcelas:', e.message);
        }
    }

    async function deleteLoanDependencies(loanId) {
        if (!loanId) return;
        // 1. Remover parcelas vinculadas ao empréstimo
        try {
            await supabase.from('pagamentos').delete().eq('loan_id', loanId);
        } catch (e) {
            console.warn('Aviso ao remover pagamentos vinculados:', e.message);
        }

        // 2. Desvincular/remover logs de notificações para evitar violação de Foreign Key
        try {
            await supabase.from('notificacao_log').delete().eq('loan_id', loanId);
        } catch (e) {
            console.warn('Aviso ao deletar notificacao_log:', e.message);
        }
        try {
            await supabase.from('notificacao_log').update({ loan_id: null }).eq('loan_id', loanId);
        } catch (e) {
            // Ignorar se a coluna ou tabela não permitir
        }
    }

    async function deletePagamentosDoLoan(loanId) {
        await deleteLoanDependencies(loanId);
    }

    async function deleteLoan(id) {
        if (!id) return;
        if (!confirm('Tem certeza que deseja excluir este registro?')) {
            return;
        }

        const stringId = String(id);

        try {
            // Limpar dependências de chaves estrangeiras
            await deleteLoanDependencies(stringId);

            // Excluir empréstimo do Supabase
            let { error } = await supabase
                .from('loans')
                .delete()
                .eq('id', stringId);

            if (error) {
                console.warn('Erro ao excluir empréstimo do Supabase:', error);
                // Se falhou por foreign key, tentar novamente limpar dependências
                if (error.message && (error.message.includes('foreign key') || error.message.includes('violates'))) {
                    await deleteLoanDependencies(stringId);
                    const retry = await supabase.from('loans').delete().eq('id', stringId);
                    if (retry.error) {
                        alert('Erro ao excluir: ' + retry.error.message);
                        return;
                    }
                } else {
                    alert('Erro ao excluir: ' + error.message);
                    return;
                }
            }

            // Limpar dados locais associados a este empréstimo
            localStorage.removeItem('loan_obs_' + stringId);
            localStorage.removeItem('loan_pago_' + stringId);
            localStorage.removeItem('loan_acordo_' + stringId);

            // Atualização otimista imediata na interface
            loans = loans.filter(l => String(l.id) !== stringId);
            renderLoans();
            atualizarSelectClientesAcordo();
            checkExpirations();
            showToast('Registro excluído com sucesso!', 'success');

            // Sincronizar em segundo plano
            loadLoans();
        } catch (err) {
            console.error('Exceção ao excluir empréstimo:', err);
            alert('Erro ao excluir: ' + err.message);
        }
    }
    window.deleteLoan = deleteLoan;

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderLoans() {
        loanList.innerHTML = '';

        if (loans.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';

        loans.forEach(loan => {
            const status = getLoanStatus(loan.data);
            const tr = document.createElement('tr');

            const isOverdue = status === 'overdue' && !loan.pago;
            if (isOverdue) tr.classList.add('row-overdue');
            if (status === 'today' && !loan.pago) tr.classList.add('row-due-today');

            let parcelasInfo = '—';
            if (loan.frequencia !== 'unique' && loan.pagamentos) {
                const juros = loan.pagamentos.filter(p => p.tipo !== 'principal');
                const principal = loan.pagamentos.find(p => p.tipo === 'principal');
                const pagas = juros.filter(p => p.pago).length;
                const total = juros.length;
                const principalPago = principal ? principal.pago : false;
                if (loan.frequencia === 'juros_only') {
                    parcelasInfo = `Juros: ${pagas}/${total}`;
                    if (principal) parcelasInfo += `<br><small>Principal: ${principalPago ? '✅' : '⏳'}</small>`;
                } else {
                    parcelasInfo = `${pagas}/${total} pagas`;
                }
                if (pagas < total) {
                    const next = juros.find(p => !p.pago);
                    if (next) parcelasInfo += `<br><small style="color:var(--text-secondary)">Próx: ${formatDate(next.dataVencimento)}</small>`;
                }
            } else if (loan.frequencia !== 'unique') {
                parcelasInfo = '—';
            }

            const statusClasse = loan.pago ? 'status-upcoming' : (status === 'overdue' ? 'status-overdue' : status === 'today' ? 'status-today' : 'status-upcoming');
            const statusTexto = loan.pago ? 'PAGO' : statusText(status);

            let acordoTagHtml = '';
            if (loan.observacao) {
                const safeObs = escapeHtml(loan.observacao);
                acordoTagHtml = `
                    <div class="acordo-badge-wrapper" title="Acordo / Observação: ${safeObs}">
                        <span class="acordo-tag"><i class="fas fa-handshake"></i> ${safeObs}</span>
                    </div>
                `;
            }

            tr.innerHTML = `
                <td>
                    <strong>${escapeHtml(loan.nome)}</strong>
                    ${acordoTagHtml}
                </td>
                <td>${escapeHtml(loan.telefone || '—')}</td>
                <td>R$ ${loan.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td>${(loan.juros && loan.juros > 0) ? (loan.tipoJuros === 'percent' ? loan.juros + '%' : 'R$ ' + loan.juros.toLocaleString('pt-BR', { minimumFractionDigits: 2 })) : '<span style="color:var(--text-secondary);">Sem juros</span>'}</td>
                <td>R$ ${loan.cobrado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style="color: #4facfe; font-weight: bold;">R$ ${loan.totalAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style="font-size:0.85rem;">${parcelasInfo}</td>
                <td>
                    ${formatDate(loan.data)} 
                    <span class="status-badge ${statusClasse}">${statusTexto}</span>
                </td>
                <td>
                    <button class="whatsapp-btn" onclick="notifyClient('${loan.id}')" title="Notificar via WhatsApp"><i class="fab fa-whatsapp"></i></button>
                    <button class="acordo-btn" onclick="abrirModalAcordo('${loan.id}')" title="Fazer Acordo"><i class="fas fa-handshake"></i> Acordo</button>
                    ${loan.frequencia !== 'unique' ? `<button class="parcelas-btn" onclick="abrirModalParcelas('${loan.id}')" title="Ver Parcelas"><i class="fas fa-list"></i></button>` : ''}
                    ${loan.frequencia === 'juros_only' ? `<button class="edit-btn" style="background:#6f42c1;color:#fff;" onclick="pagarPrincipal('${loan.id}')">Principal</button>` : ''}
                    ${loan.frequencia === 'unique' ? (loan.pago ? '' : `<button class="success-btn" style="padding:0.3rem 0.5rem;font-size:0.75rem;" onclick="marcarPagoUnico('${loan.id}')">Pagar</button>`) : ''}
                    <button class="edit-btn" onclick="editLoan('${loan.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                    <button class="danger-btn" onclick="deleteLoan('${loan.id}')" title="Excluir"><i class="fas fa-trash"></i></button>
                </td>
            `;
            loanList.appendChild(tr);
        });

        updateDashboard();
    }

    function checkExpirations() {
        alertsBar.innerHTML = '';
        const today = new Date().toISOString().split('T')[0];
        const dueToday = loans.filter(loan => {
            if (loan.frequencia !== 'unique' && loan.pagamentos) {
                return loan.pagamentos.some(p => !p.pago && p.tipo !== 'principal' && p.dataVencimento === today);
            }
            return !loan.pago && loan.data === today;
        });
        const overdue = loans.filter(loan => {
            if (loan.frequencia !== 'unique' && loan.pagamentos) {
                return loan.pagamentos.some(p => !p.pago && p.tipo !== 'principal' && p.dataVencimento < today);
            }
            return !loan.pago && loan.data < today;
        });

        if (dueToday.length > 0 || overdue.length > 0) {
            alertsBar.style.display = 'block';

            if (overdue.length > 0) {
                let msg = overdue.length + ' cobrança(s) ATRASADA(S)!';
                if (overdue.some(l => l.frequencia !== 'unique')) msg += ' (inclui parcelas)';
                const item = document.createElement('div');
                item.className = 'alert-item';
                item.innerHTML = `<span>⚠️ ${msg}</span> <button class="primary-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem;" onclick="notifyAdmin('overdue')">Me Notificar</button>`;
                alertsBar.appendChild(item);
            }

            if (dueToday.length > 0) {
                let msg = dueToday.length + ' empréstimo(s) vence(m) HOJE!';
                if (dueToday.some(l => l.frequencia !== 'unique')) msg += ' (inclui parcelas)';
                const item = document.createElement('div');
                item.className = 'alert-item';
                item.style.color = '#ffc107';
                item.innerHTML = `<span>📅 ${msg}</span> <button class="primary-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem;" onclick="notifyAdmin('today')">Me Notificar</button>`;
                alertsBar.appendChild(item);
            }
        } else {
            alertsBar.style.display = 'none';
        }
    }

    function checkAutomaticNotifications() {
        const today = new Date().toISOString().split('T')[0];

        // Notificações do navegador (uma vez por sessão)
        if (!notificacoesExibidas && 'Notification' in window && Notification.permission === 'granted') {
            notificacoesExibidas = true;
            loans.forEach(loan => {
                if (loan.frequencia !== 'unique' && loan.pagamentos) {
                    const pending = loan.pagamentos.filter(p => !p.pago);
                    pending.forEach(p => {
                        if (p.dataVencimento === today) {
                            new Notification('Parcela vence hoje!', {
                                body: `${loan.nome} - Parcela de R$ ${p.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} vence hoje.`,
                                icon: 'logo.png'
                            });
                        } else if (p.dataVencimento < today) {
                            new Notification('Parcela em atraso!', {
                                body: `${loan.nome} - Parcela de R$ ${p.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} venceu em ${formatDate(p.dataVencimento)}.`,
                                icon: 'logo.png'
                            });
                        }
                    });
                } else if (loan.frequencia === 'unique') {
                    if (loan.data === today) {
                        new Notification('Pagamento vence hoje!', {
                            body: `${loan.nome} - R$ ${loan.totalAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} vence hoje.`,
                            icon: 'logo.png'
                        });
                    } else if (loan.data < today) {
                        new Notification('Pagamento em atraso!', {
                            body: `${loan.nome} - R$ ${loan.totalAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} está atrasado.`,
                            icon: 'logo.png'
                        });
                    }
                }
            });
        }

        // Auto envio WhatsApp para pagamentos vencendo hoje
        loans.forEach(loan => {
            if (!loan.autoNotify) return;

            if (loan.frequencia !== 'unique' && loan.pagamentos) {
                const naoNotificados = loan.pagamentos.filter(p => !p.pago && p.dataVencimento <= today && !p.whatsappEnviado);
                naoNotificados.forEach(p => {
                    marcarWhatsAppEnviado(p.id);
                    p.whatsappEnviado = true;
                    autoNotificarCliente(loan, p);
                });
            } else if (loan.frequencia === 'unique') {
                if (loan.data <= today && !loan._whatsappEnviado) {
                    loan._whatsappEnviado = true;
                    autoNotificarCliente(loan, null);
                }
            }
        });
    }

    async function autoNotificarCliente(loan, parcela) {
        // Envio automático em segundo plano:
        // NUNCA abrir janela do navegador (window.open). Apenas enviar silenciosamente via API se configurada.
        if (typeof waEnviarMensagemDireta === 'function') {
            const nome = loan.nome.split(' ')[0];
            let message = '';
            if (loan.frequencia === 'parcelado') {
                const valStr = parcela ? parcela.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : loan.totalAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
                message = `Bom dia! Tudo bem?\n\n${nome}, passando para lembrar do vencimento da sua parcela do acordo (R$ ${valStr}).\n\n`;
                if (loan.observacao) {
                    message += `Referente ao nosso combinado: "${loan.observacao}"\n\n`;
                }
                message += `Qualquer dúvida ou para envio do comprovante, estou à disposição. Obrigado!`;
            } else {
                const optJuros = (loan.juros && loan.juros > 0) ? ' ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros' : '';
                message = `Bom dia! Tudo bem?\n\n${nome}, passando para lembrar que hoje vence o seu compromisso de pagamento.\n\n`;
                if (parcela) {
                    message += `Você pode realizar o pagamento do valor total da dívida (parcela de R$ ${parcela.valor.toLocaleString('pt-BR')})${optJuros}.`;
                } else {
                    message += `Você pode realizar o pagamento do valor total da dívida (R$ ${loan.totalAPagar.toLocaleString('pt-BR')})${optJuros}.`;
                }
                message += `\n\nCaso tenhamos um acordo diferente, desconsidere esta mensagem e siga as condições previamente acertadas.\n\nQualquer dúvida, estou à disposição. Obrigado!`;
            }
            const telefone = loan.telefone.replace(/\D/g, '');
            try {
                await waEnviarMensagemDireta(telefone, message);
            } catch (e) {
                console.warn('Envio automático WhatsApp API:', e.message);
            }
        }
    }

    async function marcarWhatsAppEnviado(pagamentoId) {
        try {
            await supabase.from('pagamentos').update({ whatsapp_enviado: true }).eq('id', pagamentoId);
        } catch (e) {
            console.warn('Erro ao marcar whatsapp_enviado:', e.message);
        }
    }

    // Modal de Parcelas
    window.abrirModalParcelas = async (loanId) => {
        try {
            const loan = loans.find(l => l.id == loanId);
            if (!loan) return;

            document.getElementById('modal-loan-title').textContent = `Parcelas - ${loan.nome}`;
            const tbody = document.getElementById('parcelas-list');
            const empty = document.getElementById('parcelas-empty');
            tbody.innerHTML = '';

            // Exibir observações/acordo se houver
            const acordoInfoBox = document.getElementById('modal-parcelas-acordo-info');
            const acordoTextoEl = document.getElementById('modal-acordo-texto-exibicao');
            if (loan.observacao) {
                if (acordoTextoEl) acordoTextoEl.textContent = loan.observacao;
                if (acordoInfoBox) acordoInfoBox.style.display = 'block';
            } else {
                if (acordoInfoBox) acordoInfoBox.style.display = 'none';
            }

            const { data, error } = await supabase
                .from('pagamentos')
                .select('*')
                .eq('loan_id', loanId)
                .order('data_vencimento', { ascending: true });

            if (error) {
                alert('Erro ao carregar parcelas. Execute o SQL da tabela pagamentos no Supabase: ' + error.message);
                return;
            }

            loan.pagamentos = (data || []).map(p => ({
                id: p.id,
                loanId: p.loan_id,
                dataVencimento: p.data_vencimento,
                valor: parseFloat(p.valor),
                pago: p.pago,
                dataPagamento: p.data_pagamento
            }));

            const pagamentos = loan.pagamentos;

            if (!pagamentos || pagamentos.length === 0) {
                empty.style.display = 'block';
                tbody.innerHTML = '';
            } else {
                empty.style.display = 'none';
            pagamentos.forEach((p, index) => {
                const hoje = new Date().toISOString().split('T')[0];
                const vencida = !p.pago && p.dataVencimento < hoje;
                const venceHoje = !p.pago && p.dataVencimento === hoje;
                const ehPrincipal = p.tipo === 'principal';

                const tr = document.createElement('tr');
                if (ehPrincipal) tr.style.background = 'rgba(111, 66, 193, 0.08)';
                tr.className = vencida ? 'row-overdue' : (venceHoje ? 'row-due-today' : '');
                tr.innerHTML = `
                    <td>${ehPrincipal ? '—' : (index + 1)}</td>
                    <td>${formatDate(p.dataVencimento)}</td>
                    <td>${ehPrincipal ? '<strong>R$ ' + p.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' (Principal)</strong>' : 'R$ ' + p.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td>${p.pago ? '<span class="status-badge status-upcoming">PAGO</span>' : (vencida ? '<span class="status-badge status-overdue">ATRASADO</span>' : (venceHoje ? '<span class="status-badge status-today">VENCE HOJE</span>' : '<span class="status-badge status-upcoming">A PAGAR</span>'))}</td>
                    <td>${p.dataPagamento ? formatDate(p.dataPagamento) : '—'}</td>
                    <td>${p.pago ? '✓' : (ehPrincipal ? `<button class="success-btn" style="padding:0.3rem 0.6rem;font-size:0.75rem;background:#6f42c1;" onclick="pagarPrincipal(${loanId})">Pagar Principal</button>` : `<button class="success-btn" style="padding:0.3rem 0.6rem;font-size:0.75rem;" onclick="marcarPago(${p.id}, ${loanId})">Pagar</button>`)}</td>
                `;
                tbody.appendChild(tr);
            });
            }

            document.getElementById('parcelas-modal').style.display = 'flex';
        } catch (e) {
            alert('Erro ao abrir parcelas: ' + e.message);
        }
    };

    // ============================================
    // MODAL DE ACORDO COM CLIENTE
    // ============================================
    window.abrirModalAcordo = (loanId) => {
        const loan = loans.find(l => l.id == loanId);
        if (!loan) return;

        document.getElementById('acordo-loan-id').value = loanId;
        document.getElementById('acordo-modal-title').innerHTML = `<i class="fas fa-handshake" style="color:var(--accent-purple);"></i> Fazer Acordo - ${escapeHtml(loan.nome)}`;

        // Calcular saldo pendente
        let saldoPendente = loan.totalAPagar;
        let parcelasInfo = '';
        if (loan.frequencia !== 'unique' && loan.pagamentos && loan.pagamentos.length > 0) {
            const pagas = loan.pagamentos.filter(p => p.pago).length;
            const totalP = loan.pagamentos.length;
            const pendentes = loan.pagamentos.filter(p => !p.pago);
            if (pendentes.length > 0) {
                saldoPendente = pendentes.reduce((acc, p) => acc + p.valor, 0);
            }
            parcelasInfo = `<br><span style="font-size:0.8rem;color:var(--text-secondary);">${pagas} de ${totalP} parcelas quitadas.</span>`;
        } else if (loan.pago) {
            saldoPendente = 0;
        }

        const summaryEl = document.getElementById('acordo-client-summary');
        summaryEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                <div>
                    <strong style="font-size:1.05rem;">${escapeHtml(loan.nome)}</strong>
                    <div style="color:var(--text-secondary); font-size:0.85rem;"><i class="fab fa-whatsapp"></i> ${escapeHtml(loan.telefone)}</div>
                    ${parcelasInfo}
                </div>
                <div style="text-align:right;">
                    <span style="font-size:0.8rem; color:var(--text-secondary);">Dívida / Saldo Atual:</span><br>
                    <strong style="color:var(--accent-red); font-size:1.15rem;">R$ ${saldoPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                </div>
            </div>
        `;

        const saldoVal = (saldoPendente > 0 ? saldoPendente : loan.totalAPagar) || loan.valor || 0;
        document.getElementById('acordo-valor-total').value = saldoVal > 0 ? saldoVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
        document.getElementById('acordo-juros').value = '0';
        document.getElementById('acordo-tipo-juros').value = 'fixed';
        document.getElementById('acordo-num-parcelas').value = '3';
        document.getElementById('acordo-texto-obs').value = loan.observacao || '';
        document.getElementById('acordo-auto-notify').checked = true;

        // Data do 1º vencimento: preservar data futura se houver, ou 30 dias após hoje
        if (loan.data && formatToIsoDate(loan.data) >= new Date().toISOString().split('T')[0]) {
            document.getElementById('acordo-data-primeira').value = formatToIsoDate(loan.data);
        } else {
            const proximoMes = new Date();
            proximoMes.setDate(proximoMes.getDate() + 30);
            document.getElementById('acordo-data-primeira').value = proximoMes.toISOString().split('T')[0];
        }

        atualizarCalculoAcordo();
        document.getElementById('acordo-modal').style.display = 'flex';
    };

    function atualizarCalculoAcordo(origem = '') {
        let totalVal = parseValorInput(document.getElementById('acordo-valor-total').value);
        const jurosVal = parseValorInput(document.getElementById('acordo-juros').value);
        const tipoJuros = document.getElementById('acordo-tipo-juros').value || 'fixed';
        let numParcelas = parseParcelasInput(document.getElementById('acordo-num-parcelas').value);
        let valParcela = parseValorInput(document.getElementById('acordo-valor-parcela').value);
        let data1a = document.getElementById('acordo-data-primeira').value;

        // Se o usuário digitou o valor da parcela
        if (origem === 'val' && valParcela > 0) {
            if (totalVal > 0) {
                numParcelas = Math.max(1, Math.ceil(totalVal / valParcela));
                document.getElementById('acordo-num-parcelas').value = numParcelas;
            } else if (numParcelas > 0) {
                totalVal = Math.round(valParcela * numParcelas * 100) / 100;
                document.getElementById('acordo-valor-total').value = totalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            }
        }

        const jurosCalc = tipoJuros === 'percent' ? (totalVal * (jurosVal / 100)) : jurosVal;
        const totalComJuros = Math.round((totalVal + jurosCalc) * 100) / 100;

        if (origem !== 'val') {
            if (numParcelas <= 0) numParcelas = 1;
            if (totalComJuros > 0) {
                valParcela = Math.round((totalComJuros / numParcelas) * 100) / 100;
                document.getElementById('acordo-valor-parcela').value = valParcela > 0 ? valParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
            }
        }

        const dataFmt = data1a ? formatDate(data1a) : 'a definir (padrão 30 dias)';
        const badge = document.getElementById('acordo-preview-badge');
        badge.innerHTML = `🤝 <strong>${numParcelas}x de R$ ${valParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong> todo mês (1º vencimento: ${dataFmt}) | Total do Acordo: <strong>R$ ${totalComJuros.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>`;
    }

    document.getElementById('acordo-valor-total').addEventListener('input', () => atualizarCalculoAcordo('total'));
    document.getElementById('acordo-juros').addEventListener('input', () => atualizarCalculoAcordo('juros'));
    document.getElementById('acordo-tipo-juros').addEventListener('change', () => atualizarCalculoAcordo('tipo_juros'));
    document.getElementById('acordo-num-parcelas').addEventListener('input', () => atualizarCalculoAcordo('num'));
    document.getElementById('acordo-valor-parcela').addEventListener('input', () => atualizarCalculoAcordo('val'));
    document.getElementById('acordo-data-primeira').addEventListener('input', () => atualizarCalculoAcordo('data'));
    document.getElementById('acordo-data-primeira').addEventListener('change', () => atualizarCalculoAcordo('data'));

    window.fecharModalAcordo = () => {
        const modal = document.getElementById('acordo-modal');
        if (modal) modal.style.display = 'none';
    };

    window.confirmarSalvarAcordo = async () => {
        try {
            const loanId = document.getElementById('acordo-loan-id').value;
            const loan = loans.find(l => l.id == loanId);
            if (!loan) {
                alert('Empréstimo não encontrado. Por favor, feche e abra o acordo novamente.');
                return;
            }

            let totalVal = parseValorInput(document.getElementById('acordo-valor-total').value);
            const jurosVal = parseValorInput(document.getElementById('acordo-juros').value);
            const tipoJuros = document.getElementById('acordo-tipo-juros').value || 'fixed';
            let numParcelas = parseParcelasInput(document.getElementById('acordo-num-parcelas').value);
            let valParcela = parseValorInput(document.getElementById('acordo-valor-parcela').value);
            let data1a = formatToIsoDate(document.getElementById('acordo-data-primeira').value);
            const textoObs = document.getElementById('acordo-texto-obs').value.trim();
            const autoNotify = document.getElementById('acordo-auto-notify').checked;

            // 1. Fallback totalVal
            if (totalVal <= 0 && valParcela > 0 && numParcelas > 0) {
                totalVal = Math.round(valParcela * numParcelas * 100) / 100;
            }
            if (totalVal <= 0) {
                totalVal = loan.totalAPagar || loan.valor || 0;
                if (loan.pagamentos && loan.pagamentos.length > 0) {
                    const pendentes = loan.pagamentos.filter(p => !p.pago);
                    if (pendentes.length > 0) {
                        totalVal = pendentes.reduce((acc, p) => acc + p.valor, 0);
                    }
                }
            }

            // 2. Fallback numParcelas
            if (numParcelas <= 0) {
                numParcelas = (valParcela > 0 && totalVal > 0) ? Math.max(1, Math.ceil(totalVal / valParcela)) : 1;
            }

            // 3. Fallback data1a
            if (!data1a) {
                if (loan.data) {
                    data1a = formatToIsoDate(loan.data);
                } else {
                    const proximoMes = new Date();
                    proximoMes.setDate(proximoMes.getDate() + 30);
                    data1a = proximoMes.toISOString().split('T')[0];
                }
                document.getElementById('acordo-data-primeira').value = data1a;
            }

            if (totalVal <= 0) {
                totalVal = 0;
            }

            const jurosCalc = tipoJuros === 'percent' ? (totalVal * (jurosVal / 100)) : jurosVal;
            const totalFinal = Math.round((totalVal + jurosCalc) * 100) / 100;

            if (valParcela <= 0) {
                valParcela = Math.round((totalFinal / numParcelas) * 100) / 100;
            }

            const diaVencto = parseInt(data1a.split('-')[2]) || 1;

            const payload = {
                valor: totalVal,
                juros: jurosVal,
                tipo_juros: tipoJuros,
                valor_cobrado: 0,
                total_a_pagar: totalFinal,
                data_pagamento: data1a,
                frequencia: 'parcelado',
                numero_parcelas: numParcelas,
                valor_parcela: valParcela,
                dia_vencimento: diaVencto,
                auto_notify: autoNotify,
                observacao: textoObs
            };

            let updateRes = await supabase.from('loans').update(payload).eq('id', loanId);

            // Se der erro por alguma coluna não existente no Supabase (ex: observacao ou schema cache antigo)
            if (updateRes.error) {
                const msg = updateRes.error.message || '';
                const matchCol = msg.match(/Could not find the '([^']+)' column/i);
                if (matchCol && matchCol[1]) {
                    const colInvalida = matchCol[1];
                    delete payload[colInvalida];
                    if (colInvalida === 'observacao' && textoObs) {
                        localStorage.setItem('loan_obs_' + loanId, textoObs);
                    }
                    updateRes = await supabase.from('loans').update(payload).eq('id', loanId);
                }

                if (updateRes.error && updateRes.error.message && updateRes.error.message.includes('observacao')) {
                    delete payload.observacao;
                    localStorage.setItem('loan_obs_' + loanId, textoObs);
                    updateRes = await supabase.from('loans').update(payload).eq('id', loanId);
                }
            }

            if (updateRes.error) {
                alert('Erro ao salvar acordo: ' + updateRes.error.message);
                return;
            }

            localStorage.removeItem('loan_pago_' + loanId);

            if (textoObs) {
                localStorage.setItem('loan_obs_' + loanId, textoObs);
            }

            // Exclui parcelas antigas e gera o novo cronograma de parcelas mensais
            await deletePagamentosDoLoan(loanId);
            await gerarParcelas(loanId, valParcela, numParcelas, 'parcelado', totalFinal, jurosCalc, data1a);

            fecharModalAcordo();
            showToast('Acordo registrado com sucesso! Parcelas geradas.');
            loadLoans();
        } catch (e) {
            alert('Erro ao salvar acordo: ' + e.message);
        }
    };

    // Pagar Principal (juros_only)
    window.pagarPrincipal = async (loanId) => {
        if (!confirm('Confirmar pagamento do valor principal?')) return;
        try {
            const loan = loans.find(l => l.id == loanId);
            if (!loan) return;
            const principal = loan.pagamentos.find(p => p.tipo === 'principal');
            if (!principal) { alert('Principal não encontrado.'); return; }
            const hoje = new Date().toISOString().split('T')[0];
            const { error } = await supabase.from('pagamentos').update({ pago: true, data_pagamento: hoje }).eq('id', principal.id);
            if (error) alert('Erro: ' + error.message);
            else { loadLoans(); if (document.getElementById('parcelas-modal').style.display === 'flex') abrirModalParcelas(loanId); }
        } catch (e) { alert('Erro: ' + e.message); }
    };

    window.fecharModalParcelas = () => {
        const modal = document.getElementById('parcelas-modal');
        if (modal) modal.style.display = 'none';
    };

    window.marcarPago = async (pagamentoId, loanId) => {
        try {
            const hoje = new Date().toISOString().split('T')[0];
            const { error } = await supabase
                .from('pagamentos')
                .update({ pago: true, data_pagamento: hoje })
                .eq('id', pagamentoId);

            if (error) {
                alert('Erro ao marcar como pago: ' + error.message);
            } else {
                abrirModalParcelas(loanId);
                loadLoans();
            }
        } catch (e) {
            alert('Erro ao marcar pagamento: ' + e.message);
        }
    };

    // Fechar modais clicando fora
    document.addEventListener('click', (e) => {
        const modal = document.getElementById('parcelas-modal');
        if (e.target === modal) modal.style.display = 'none';
        const acordoModal = document.getElementById('acordo-modal');
        if (e.target === acordoModal) acordoModal.style.display = 'none';
    });

    function updateDashboard() {
        const totalEmprestadoEl = document.getElementById('total-emprestado');
        const totalMensalEl = document.getElementById('total-mensal');
        const totalClientesEl = document.getElementById('total-clientes');
        const totalAtrasoEl = document.getElementById('total-atraso');

        let totalEmprestado = 0;
        let totalLucro = 0;
        let totalAtraso = 0;

        const statusCounts = { overdue: 0, today: 0, upcoming: 0 };
        const clientLabels = [];
        const clientProfitValues = [];

        loans.forEach(loan => {
            const profit = loan.totalAPagar - loan.valor;
            const status = getLoanStatus(loan.data);

            totalEmprestado += loan.valor;
            totalLucro += profit;

            // Verificar atraso considerando parcelas
            let temAtraso = status === 'overdue' && !loan.pago;
            let valorAtraso = 0;
            if (loan.frequencia !== 'unique' && loan.pagamentos) {
                const hojeStr = new Date().toISOString().split('T')[0];
                const pagasAtraso = loan.pagamentos.filter(p => !p.pago && p.dataVencimento < hojeStr);
                temAtraso = pagasAtraso.length > 0;
                valorAtraso = pagasAtraso.reduce((acc, p) => acc + p.valor, 0);
            } else {
                valorAtraso = temAtraso ? loan.totalAPagar : 0;
            }
            if (temAtraso) {
                totalAtraso += valorAtraso;
            }

            // Status do empréstimo (considerando parcelas)
            let loanStatus = status;
            if (loan.frequencia !== 'unique' && loan.pagamentos) {
                const pendentes = loan.pagamentos.filter(p => !p.pago && p.tipo !== 'principal');
                const principalPendente = loan.pagamentos.some(p => p.tipo === 'principal' && !p.pago);
                const hoje2 = new Date().toISOString().split('T')[0];
                if (pendentes.length === 0 && !principalPendente) {
                    loanStatus = 'upcoming';
                } else if (pendentes.some(p => p.dataVencimento < hoje2)) {
                    loanStatus = 'overdue';
                } else if (pendentes.some(p => p.dataVencimento === hoje2)) {
                    loanStatus = 'today';
                } else {
                    loanStatus = 'upcoming';
                }
            }

            statusCounts[loanStatus]++;
            clientLabels.push(loan.nome);
            clientProfitValues.push(profit);
        });

        totalEmprestadoEl.textContent = `R$ ${totalEmprestado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        totalMensalEl.textContent = `R$ ${totalLucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        totalClientesEl.textContent = loans.length;
        totalAtrasoEl.textContent = `R$ ${totalAtraso.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

        const ctxLoan = document.getElementById('loanChart').getContext('2d');
        const chartColors = ['#3b82f6', '#10b981', '#06b6d4', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#6366f1'];
        const isDark = !document.body.getAttribute('data-theme') || document.body.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#94a3b8' : '#64748b';
        const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
        const bgColors = clientLabels.map((_, i) => {
            const color = chartColors[i % chartColors.length];
            return color + 'cc';
        });

        if (loanChart) {
            loanChart.data.labels = clientLabels;
            loanChart.data.datasets[0].data = clientProfitValues;
            loanChart.data.datasets[0].backgroundColor = bgColors;
            loanChart.data.datasets[0].borderColor = clientLabels.map((_, i) => chartColors[i % chartColors.length]);
            loanChart.options.scales.x.ticks.color = textColor;
            loanChart.options.scales.y.ticks.color = textColor;
            loanChart.update();
        } else {
            loanChart = new Chart(ctxLoan, {
                type: 'bar',
                data: {
                    labels: clientLabels,
                    datasets: [{
                        label: 'Lucro (R$)',
                        data: clientProfitValues,
                        backgroundColor: bgColors,
                        borderColor: clientLabels.map((_, i) => chartColors[i % chartColors.length]),
                        borderWidth: 2,
                        borderRadius: 8,
                        borderSkipped: false,
                        barThickness: clientLabels.length > 6 ? 14 : 22
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: isDark ? '#1e293b' : '#ffffff',
                            titleColor: isDark ? '#f1f5f9' : '#0f172a',
                            bodyColor: isDark ? '#94a3b8' : '#64748b',
                            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                            borderWidth: 1,
                            padding: 12,
                            cornerRadius: 8,
                            displayColors: true,
                            boxPadding: 4,
                            callbacks: { label: ctx => `Lucro: R$ ${ctx.parsed.x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: textColor, callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter', size: 10 } },
                            grid: { color: gridColor },
                            border: { display: false }
                        },
                        y: {
                            ticks: { color: textColor, font: { family: 'Inter', size: 11, weight: 500 }, padding: 8 },
                            grid: { display: false },
                            border: { display: false }
                        }
                    }
                }
            });
        }

        const ctxStatus = document.getElementById('statusChart').getContext('2d');
        const statusData = [statusCounts.overdue, statusCounts.today, statusCounts.upcoming];
        const statusLabels = ['Atrasado', 'Vence Hoje', 'No Prazo'];

        if (statusChart) {
            statusChart.data.datasets[0].data = statusData;
            statusChart.options.plugins.legend.labels.color = textColor;
            statusChart.update();
        } else {
            statusChart = new Chart(ctxStatus, {
                type: 'doughnut',
                data: {
                    labels: statusLabels,
                    datasets: [{
                        data: statusData,
                        backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
                        borderWidth: 3,
                        borderColor: isDark ? '#111827' : '#ffffff',
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: { position: 'right', labels: { color: textColor, font: { size: 11, family: 'Inter' }, padding: 12, usePointStyle: true, pointStyleWidth: 10 } },
                        tooltip: { backgroundColor: isDark ? '#1e293b' : '#ffffff', titleColor: isDark ? '#f1f5f9' : '#0f172a', bodyColor: isDark ? '#94a3b8' : '#64748b', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: true, boxPadding: 4 }
                    }
                }
            });
        }
    }

    window.notifyClient = async (id) => {
        const loan = loans.find(l => l.id == id);
        if (!loan) return;
        if (!loan.telefone || !loan.telefone.replace(/\D/g, '')) {
            alert('Este cliente não possui telefone/WhatsApp cadastrado.');
            return;
        }
        const nome = loan.nome.split(' ')[0];
        let message = '';
        let valorParcela = 0;

        if (loan.frequencia === 'parcelado') {
            let parcelaTexto = '';
            if (loan.pagamentos) {
                const pendentes = loan.pagamentos.filter(p => !p.pago);
                if (pendentes.length > 0) {
                    const prox = pendentes[0];
                    const idx = loan.pagamentos.indexOf(prox) + 1;
                    valorParcela = prox.valor;
                    parcelaTexto = `(Parcela ${idx} de ${loan.pagamentos.length} - R$ ${prox.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`;
                    for (const p of pendentes) {
                        if (!p.whatsappEnviado) {
                            p.whatsappEnviado = true;
                            supabase.from('pagamentos').update({ whatsapp_enviado: true }).eq('id', p.id).catch(()=>{});
                        }
                    }
                } else {
                    message = `Olá ${loan.nome}, suas parcelas do acordo estão todas em dia!`;
                }
            } else {
                valorParcela = loan.totalAPagar;
            }

            if (!message) {
                message = `Bom dia! Tudo bem?\n\n${nome}, passando para lembrar do vencimento da sua parcela do acordo ${parcelaTexto}.\n\n`;
                if (loan.observacao) {
                    message += `Referente ao nosso combinado: "${loan.observacao}"\n\n`;
                }
                message += `Qualquer dúvida ou para envio do comprovante, estou à disposição. Obrigado!`;
            }
        } else if (loan.frequencia !== 'unique' && loan.pagamentos) {
            const pendentes = loan.pagamentos.filter(p => !p.pago);
            if (pendentes.length > 0) {
                const prox = pendentes[0];
                valorParcela = prox.valor;
                const optJuros = (loan.juros && loan.juros > 0) ? ' ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros' : '';
                message += `Bom dia! Tudo bem?\n\n${nome}, passando para lembrar que hoje vence o seu compromisso de pagamento.\n\n`;
                message += `Você pode realizar o pagamento do valor total da dívida (parcela de R$ ${prox.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})${optJuros}.`;
                for (const p of pendentes) {
                    if (!p.whatsappEnviado) {
                        p.whatsappEnviado = true;
                        await supabase.from('pagamentos').update({ whatsapp_enviado: true }).eq('id', p.id);
                    }
                }
            } else {
                message = `Olá ${loan.nome}, suas parcelas estão todas em dia!`;
            }
        } else {
            valorParcela = loan.totalAPagar;
            const optJuros = (loan.juros && loan.juros > 0) ? ' ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros' : '';
            message += `Bom dia! Tudo bem?\n\n${nome}, passando para lembrar que hoje vence o seu compromisso de pagamento.\n\n`;
            message += `Você pode realizar o pagamento do valor total da dívida (R$ ${loan.totalAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})${optJuros}.`;
            loan._whatsappEnviado = true;
        }

        if (loan.frequencia !== 'parcelado' && !message.startsWith('Olá')) {
            message += `\n\nCaso tenhamos um acordo diferente, desconsidere esta mensagem e siga as condições previamente acertadas.\n\nQualquer dúvida, estou à disposição. Obrigado!`;
        }

        // Tentar enviar via API WA usando wa-manager
        if (typeof waEnviarMensagemDireta === 'function') {
            const telefone = loan.telefone.replace(/\D/g, '');
            const enviou = await waEnviarMensagemDireta(telefone, message);
            if (enviou) {
                try {
                    const user = (await supabase.auth.getUser()).data.user;
                    if (user) {
                        await supabase.from('notificacao_log').insert([{
                            user_id: user.id, loan_id: loan.id,
                            cliente_nome: loan.nome, cliente_telefone: loan.telefone,
                            parcela_valor: valorParcela, mensagem: message,
                            status: 'enviado', tipo_envio: 'manual'
                        }]);
                    }
                } catch (e) {}
                return;
            }
        }
        // Fallback: abrir wa.me
        const url = `https://wa.me/${loan.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    window.notifyAdmin = (type) => {
        const message = type === 'overdue'
            ? `Aviso de Cobrança: Existem clientes com pagamentos atrasados no sistema.`
            : `Lembrete: Existem pagamentos vencendo hoje. Confira o painel!`;
        const url = `https://wa.me/${ADMIN_PHONE}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    function getLoanStatus(dateStr) {
        if (!dateStr) return 'upcoming';
        const clean = String(dateStr).split('T')[0].split(' ')[0];
        const today = new Date().toISOString().split('T')[0];
        if (clean < today) return 'overdue';
        if (clean === today) return 'today';
        return 'upcoming';
    }

    function statusText(status) {
        if (status === 'overdue') return 'ATRASADO';
        if (status === 'today') return 'VENCE HOJE';
        return 'NO PRAZO';
    }

    async function marcarPagoUnico(id) {
        if (!confirm('Marcar este empréstimo como PAGO?')) return;
        localStorage.setItem('loan_pago_' + id, 'true');
        const res = await supabase.from('loans').update({ pago: true }).eq('id', id);
        if (res.error) {
            console.warn('Coluna pago não disponível em loans (salvo localmente):', res.error.message);
        }
        loadLoans();
    }

    function editLoan(id) {
        const loan = loans.find(l => String(l.id) === String(id));
        if (!loan) return;

        editingLoanId = id;

        // Manter sempre na aba normal para edição completa e transparente sem resetar campos
        alternarAbaFormulario('normal');

        loanForm.nome.value = loan.nome || '';
        loanForm.telefone.value = loan.telefone || '';
        loanForm.valor.value = (loan.valor !== undefined && loan.valor !== null) ? loan.valor : '';
        loanForm.juros.value = (loan.juros !== undefined && loan.juros !== null) ? loan.juros : '';
        loanForm.tipoJuros.value = loan.tipoJuros || 'percent';
        loanForm.cobrado.value = loan.cobrado || '';
        loanForm.data.value = formatToIsoDate(loan.data);
        loanForm.frequencia.value = loan.frequencia || 'unique';

        if (loanForm.numeroParcelas) {
            loanForm.numeroParcelas.value = loan.numeroParcelas || '';
        }
        if (loan.valorParcela) {
            loanForm.valorParcela.value = loan.valorParcela;
        } else {
            loanForm.valorParcela.value = '';
        }
        if (loanForm.observacao) {
            loanForm.observacao.value = loan.observacao || '';
        }

        autoNotifyCheck.checked = loan.autoNotify || false;

        // Disparar change para atualizar visibilidade dos campos condicionais
        loanForm.frequencia.dispatchEvent(new Event('change'));

        // Garantir que a data permaneça a data do empréstimo após o dispatchEvent
        loanForm.data.value = formatToIsoDate(loan.data);

        addBtn.textContent = 'Salvar Alterações';
        addBtn.classList.remove('primary-btn');
        addBtn.classList.add('success-btn');
        if (cancelEditBtn) cancelEditBtn.style.display = 'inline-block';

        window.scrollTo({ top: 0, behavior: 'smooth' });
        loanForm.data.focus();
    }

    window.deleteLoan = deleteLoan;
    window.editLoan = editLoan;
    window.clearForm = clearForm;

    function clearForm() {
        editingLoanId = null;
        if (acordoClienteSelect) acordoClienteSelect.value = '';
        if (currentFormTab === 'acordo') {
            alternarAbaFormulario('normal');
        } else {
            addBtn.textContent = 'Adicionar Novo Cliente';
            addBtn.style.background = '';
            addBtn.classList.remove('success-btn');
            addBtn.classList.add('primary-btn');
        }
        if (cancelEditBtn) cancelEditBtn.style.display = 'none';

        loanForm.nome.value = '';
        loanForm.telefone.value = '';
        loanForm.valor.value = '';
        loanForm.juros.value = '';
        loanForm.cobrado.value = '';
        loanForm.data.value = '';
        loanForm.frequencia.value = 'unique';
        if (loanForm.numeroParcelas) loanForm.numeroParcelas.value = '';
        loanForm.valorParcela.value = '';
        if (loanForm.observacao) loanForm.observacao.value = '';
        autoNotifyCheck.checked = true;
        autoNotifyGroup.style.display = 'none';
        parcelasGroup.style.display = 'none';
        if (parcelasNumGroup) parcelasNumGroup.style.display = 'none';
        diaSemanaGroup.style.display = 'none';
        diaMesGroup.style.display = 'none';
        diaSemana.value = '0';
        diaMes.value = '1';
        parcelasPreview.textContent = '';
        if (labelJuros) labelJuros.innerHTML = 'Juros <span style="font-size:0.8rem;color:var(--text-secondary);font-weight:normal;">(Opcional)</span>:';
        loanForm.juros.placeholder = '0 (opcional)';
        if (labelDataPagamento) labelDataPagamento.textContent = 'Data de Pagamento:';
        atualizarPreviewParcelas();
        loanForm.nome.focus();
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const clean = String(dateStr).split('T')[0].split(' ')[0];
        const parts = clean.split('-');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        }
        return dateStr;
    }

    function toggleTheme() {
        const theme = themeSelect.value;
        document.body.setAttribute('data-theme', theme);
    }

    // Navegação
    function mostrarSecoesPrincipais() {
        document.getElementById('wa-panel').style.display = 'none';
        document.getElementById('rendas-panel').style.display = 'none';
        document.getElementById('relatorios-panel').style.display = 'none';
        document.querySelector('.form-container').style.display = '';
        document.querySelector('.dashboard-stats').style.display = '';
        document.querySelector('.list-container').style.display = '';
        document.getElementById('generate-report-btn').style.display = '';
    }
    function mostrarWaPanel() {
        document.querySelector('.form-container').style.display = 'none';
        document.querySelector('.dashboard-stats').style.display = 'none';
        document.querySelector('.list-container').style.display = 'none';
        document.getElementById('generate-report-btn').style.display = 'none';
        document.getElementById('rendas-panel').style.display = 'none';
        document.getElementById('relatorios-panel').style.display = 'none';
        document.getElementById('wa-panel').style.display = '';
    }

    // ============================================
    // OUTRAS RENDAS
    // ============================================
    let rendas = [];
    let editingRendaId = null;
    let rendasChart = null;
    let totalChart = null;

    const rendaForm = {
        nome: document.getElementById('renda-nome'),
        valor: document.getElementById('renda-valor'),
        data: document.getElementById('renda-data'),
        tipo: document.getElementById('renda-tipo'),
        recorrente: document.getElementById('renda-recorrente'),
        observacao: document.getElementById('renda-observacao')
    };
    const addRendaBtn = document.getElementById('add-renda-btn');
    const rendaList = document.getElementById('renda-list');
    const rendasEmptyState = document.getElementById('rendas-empty-state');

    // Definir data de hoje como padrão
    rendaForm.data.value = new Date().toISOString().split('T')[0];

    window.mostrarRendas = function() {
        document.querySelector('.form-container').style.display = 'none';
        document.querySelector('.dashboard-stats').style.display = 'none';
        document.querySelector('.list-container').style.display = 'none';
        document.getElementById('generate-report-btn').style.display = 'none';
        document.getElementById('wa-panel').style.display = 'none';
        document.getElementById('relatorios-panel').style.display = 'none';
        document.getElementById('rendas-panel').style.display = '';
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-rendas').classList.add('active');
        loadRendas();
    };

    if (addRendaBtn) addRendaBtn.addEventListener('click', addRenda);

    async function loadRendas() {
        const { data, error } = await supabase
            .from('rendas')
            .select('*')
            .order('data_renda', { ascending: false });

        if (error) {
            console.warn('Erro ao carregar rendas do Supabase, tentando fallback local:', error.message);
            const local = JSON.parse(localStorage.getItem('local_rendas') || '[]');
            rendas = local.map(r => ({
                id: r.id,
                nome: r.nome,
                valor: parseFloat(r.valor),
                data: r.data || r.data_renda,
                tipo: r.tipo || 'fixa',
                recorrente: r.recorrente || false,
                observacao: r.observacao || ''
            }));
            renderRendas();
            updateRendasDashboard();
            return;
        }

        rendas = (data || []).map(r => ({
            id: r.id,
            nome: r.nome,
            valor: parseFloat(r.valor),
            data: r.data_renda,
            tipo: r.tipo || 'fixa',
            recorrente: r.recorrente || false,
            observacao: r.observacao || ''
        }));

        renderRendas();
        updateRendasDashboard();
    }

    async function addRenda() {
        const nome = rendaForm.nome.value.trim();
        const valor = parseFloat(rendaForm.valor.value);
        const data = rendaForm.data.value;
        const tipo = rendaForm.tipo.value;
        const recorrente = rendaForm.recorrente.checked;
        const observacao = rendaForm.observacao.value.trim();

        if (!nome || isNaN(valor) || valor <= 0 || !data) {
            alert('Preencha nome, valor e data.');
            return;
        }

        const payload = {
            user_id: user.id,
            nome,
            valor,
            data_renda: data,
            tipo,
            recorrente,
            observacao
        };

        if (editingRendaId) {
            const stringId = String(editingRendaId);
            if (stringId.startsWith('local_')) {
                const local = JSON.parse(localStorage.getItem('local_rendas') || '[]');
                const idx = local.findIndex(r => String(r.id) === stringId);
                if (idx !== -1) {
                    local[idx] = { ...local[idx], ...payload, data: payload.data_renda };
                    localStorage.setItem('local_rendas', JSON.stringify(local));
                }
            } else {
                try {
                    const { error } = await supabase.from('rendas').update(payload).eq('id', editingRendaId);
                    if (error) {
                        console.warn('Erro ao atualizar no Supabase, salvando em localStorage:', error.message);
                        const local = JSON.parse(localStorage.getItem('local_rendas') || '[]');
                        const idx = local.findIndex(r => String(r.id) === stringId);
                        if (idx !== -1) {
                            local[idx] = { ...local[idx], ...payload, data: payload.data_renda };
                        } else {
                            local.push({ id: stringId, ...payload, data: payload.data_renda });
                        }
                        localStorage.setItem('local_rendas', JSON.stringify(local));
                    }
                } catch (e) {
                    console.warn('Exceção ao atualizar renda:', e);
                }
            }
            editingRendaId = null;
            addRendaBtn.textContent = 'Adicionar Renda';
            addRendaBtn.classList.remove('success-btn');
            addRendaBtn.classList.add('primary-btn');
            showToast('Renda atualizada com sucesso!', 'success');
        } else {
            let savedInSupabase = false;
            try {
                const { error } = await supabase.from('rendas').insert([payload]);
                if (!error) savedInSupabase = true;
            } catch (e) {}

            if (!savedInSupabase) {
                const local = JSON.parse(localStorage.getItem('local_rendas') || '[]');
                local.push({ id: 'local_' + Date.now(), ...payload, data: payload.data_renda });
                localStorage.setItem('local_rendas', JSON.stringify(local));
            }
            showToast('Renda adicionada com sucesso!', 'success');
        }

        clearRendaForm();
        loadRendas();
    }

    window.editarRenda = function(id) {
        const stringId = String(id);
        const renda = rendas.find(r => String(r.id) === stringId);
        if (!renda) return;

        editingRendaId = id;
        rendaForm.nome.value = renda.nome || '';
        rendaForm.valor.value = renda.valor || '';
        rendaForm.data.value = renda.data || '';
        rendaForm.tipo.value = renda.tipo || 'fixa';
        rendaForm.recorrente.checked = !!renda.recorrente;
        rendaForm.observacao.value = renda.observacao || '';

        addRendaBtn.textContent = 'Salvar Alterações';
        addRendaBtn.classList.remove('primary-btn');
        addRendaBtn.classList.add('success-btn');
        rendaForm.nome.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.excluirRenda = async function(id) {
        if (!id) return;
        if (!confirm('Tem certeza que deseja excluir esta renda?')) return;

        const stringId = String(id);

        // 1. Sempre remover do localStorage
        try {
            const local = JSON.parse(localStorage.getItem('local_rendas') || '[]');
            const filteredLocal = local.filter(r => String(r.id) !== stringId);
            localStorage.setItem('local_rendas', JSON.stringify(filteredLocal));
        } catch (e) {
            console.warn('Erro ao remover de local_rendas:', e);
        }

        // 2. Se for ID do Supabase (UUID ou número, não iniciado por local_), tentar deletar do banco
        if (!stringId.startsWith('local_')) {
            try {
                const { error } = await supabase.from('rendas').delete().eq('id', id);
                if (error) {
                    console.warn('Erro ao excluir renda do Supabase:', error.message);
                }
            } catch (e) {
                console.warn('Exceção ao deletar renda do Supabase:', e);
            }
        }

        // 3. Atualizar estado em memória imediatamente (otimista)
        rendas = rendas.filter(r => String(r.id) !== stringId);
        renderRendas();
        updateRendasDashboard();
        showToast('Renda excluída com sucesso!', 'success');

        // 4. Sincronizar da fonte oficial
        loadRendas();
    };

    function clearRendaForm() {
        editingRendaId = null;
        rendaForm.nome.value = '';
        rendaForm.valor.value = '';
        rendaForm.data.value = new Date().toISOString().split('T')[0];
        rendaForm.tipo.value = 'fixa';
        rendaForm.recorrente.checked = false;
        rendaForm.observacao.value = '';
        addRendaBtn.textContent = 'Adicionar Renda';
        addRendaBtn.classList.remove('success-btn');
        addRendaBtn.classList.add('primary-btn');
    }

    function renderRendas() {
        rendaList.innerHTML = '';
        const busca = (document.getElementById('renda-busca')?.value || '').toLowerCase();

        const filtradas = rendas.filter(r =>
            r.nome.toLowerCase().includes(busca) ||
            r.tipo.toLowerCase().includes(busca) ||
            (r.observacao && r.observacao.toLowerCase().includes(busca))
        );

        if (filtradas.length === 0) {
            rendasEmptyState.style.display = 'block';
            return;
        }
        rendasEmptyState.style.display = 'none';

        const tipoLabels = { fixa: 'Fixa', variavel: 'Variável', investimento: 'Investimento', freelance: 'Freelance', outro: 'Outro' };

        filtradas.forEach(renda => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${renda.nome}</strong></td>
                <td style="color:#28a745;font-weight:bold;">R$ ${renda.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td>${formatDate(renda.data)}</td>
                <td>${tipoLabels[renda.tipo] || renda.tipo}</td>
                <td>${renda.recorrente ? '<span class="status-badge status-upcoming">Sim</span>' : '<span style="color:var(--text-secondary)">Não</span>'}</td>
                <td style="color:var(--text-secondary);font-size:0.85rem;">${renda.observacao || '—'}</td>
                <td>
                    <button class="edit-btn" onclick="editarRenda('${renda.id}')">Editar</button>
                    <button class="danger-btn" onclick="excluirRenda('${renda.id}')">Excluir</button>
                </td>
            `;
            rendaList.appendChild(tr);
        });
    }

    function updateRendasDashboard() {
        const totalRendasEl = document.getElementById('total-rendas');
        const rendasFixasEl = document.getElementById('rendas-fixas');
        const rendasRecorrentesEl = document.getElementById('rendas-recorrentes');
        const rendasFontesEl = document.getElementById('rendas-fontes');

        let totalRendas = 0;
        let fixas = 0;
        let recorrentes = 0;

        rendas.forEach(r => {
            totalRendas += r.valor;
            if (r.tipo === 'fixa') fixas += r.valor;
            if (r.recorrente) recorrentes++;
        });

        const fontes = [...new Set(rendas.map(r => r.tipo))].length;

        totalRendasEl.textContent = `R$ ${totalRendas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        rendasFixasEl.textContent = `R$ ${fixas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        rendasRecorrentesEl.textContent = recorrentes;
        rendasFontesEl.textContent = fontes;

        // Gráfico de rendas por tipo
        const tipoLabels = { fixa: 'Fixa', variavel: 'Variável', investimento: 'Investimento', freelance: 'Freelance', outro: 'Outro' };
        const tipoMap = {};
        rendas.forEach(r => {
            const label = tipoLabels[r.tipo] || r.tipo;
            tipoMap[label] = (tipoMap[label] || 0) + r.valor;
        });

        const ctxRendas = document.getElementById('rendasChart').getContext('2d');
        const tipoLabelsArr = Object.keys(tipoMap);
        const tipoValuesArr = Object.values(tipoMap);
        const rendasColors = ['#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#f97316', '#ef4444'];
        const isDark2 = !document.body.getAttribute('data-theme') || document.body.getAttribute('data-theme') === 'dark';
        const textColor2 = isDark2 ? '#94a3b8' : '#64748b';

        if (rendasChart) {
            rendasChart.data.labels = tipoLabelsArr;
            rendasChart.data.datasets[0].data = tipoValuesArr;
            rendasChart.options.plugins.legend.labels.color = textColor2;
            rendasChart.update();
        } else if (tipoLabelsArr.length > 0) {
            rendasChart = new Chart(ctxRendas, {
                type: 'doughnut',
                data: {
                    labels: tipoLabelsArr,
                    datasets: [{
                        data: tipoValuesArr,
                        backgroundColor: rendasColors,
                        borderWidth: 3,
                        borderColor: isDark2 ? '#111827' : '#ffffff',
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: { position: 'right', labels: { color: textColor2, font: { size: 11, family: 'Inter' }, padding: 12, usePointStyle: true, pointStyleWidth: 10 } },
                        tooltip: { backgroundColor: isDark2 ? '#1e293b' : '#ffffff', titleColor: isDark2 ? '#f1f5f9' : '#0f172a', bodyColor: isDark2 ? '#94a3b8' : '#64748b', borderColor: isDark2 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: true, boxPadding: 4 }
                    }
                }
            });
        }

        // Gráfico comparativo Empréstimos vs Outras Rendas
        const totalEmprestado = loans.reduce((acc, l) => acc + l.totalAPagar, 0);
        const ctxTotal = document.getElementById('totalChart').getContext('2d');

        if (totalChart) {
            totalChart.data.datasets[0].data = [totalEmprestado, totalRendas];
            totalChart.options.scales.x.ticks.color = textColor2;
            totalChart.options.scales.y.ticks.color = textColor2;
            totalChart.options.scales.x.grid.color = isDark2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
            totalChart.options.scales.y.grid.color = isDark2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
            totalChart.update();
        } else {
            totalChart = new Chart(ctxTotal, {
                type: 'bar',
                data: {
                    labels: ['Empréstimos', 'Outras Rendas'],
                    datasets: [{
                        label: 'R$ Total',
                        data: [totalEmprestado, totalRendas],
                        backgroundColor: ['rgba(59, 130, 246, 0.8)', 'rgba(245, 158, 11, 0.8)'],
                        borderColor: ['#3b82f6', '#f59e0b'],
                        borderWidth: 2,
                        borderRadius: 8,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: isDark2 ? '#1e293b' : '#ffffff', titleColor: isDark2 ? '#f1f5f9' : '#0f172a', bodyColor: isDark2 ? '#94a3b8' : '#64748b', borderColor: isDark2 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderWidth: 1, padding: 12, cornerRadius: 8, callbacks: { label: ctx => 'R$ ' + ctx.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) } }
                    },
                    scales: {
                        x: { ticks: { color: textColor2, font: { family: 'Inter', weight: 500 } }, grid: { display: false }, border: { display: false } },
                        y: { ticks: { color: textColor2, callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter' } }, grid: { color: isDark2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }, border: { display: false } }
                    }
                }
            });
        }
    }

    window.filtrarRendas = function() {
        renderRendas();
    };

    // ============================================
    // RELATÓRIOS & EVOLUÇÃO
    // ============================================
    let evolucaoChart = null;
    let lucroMensalChart = null;
    let composicaoChart = null;

    // Popular select de anos
    const relatorioAno = document.getElementById('relatorio-ano');
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 5; y--) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        relatorioAno.appendChild(opt);
    }
    // Mês atual como padrão
    document.getElementById('relatorio-mes').value = new Date().getMonth();
    document.getElementById('relatorio-ano').value = currentYear;

    // Mostrar/esconder mês conforme período
    document.getElementById('relatorio-periodo').addEventListener('change', function() {
        document.getElementById('relatorio-mes').parentElement.style.display = this.value === 'mensal' ? '' : 'none';
    });

    window.mostrarRelatorios = function() {
        document.querySelector('.form-container').style.display = 'none';
        document.querySelector('.dashboard-stats').style.display = 'none';
        document.querySelector('.list-container').style.display = 'none';
        document.getElementById('generate-report-btn').style.display = 'none';
        document.getElementById('wa-panel').style.display = 'none';
        document.getElementById('rendas-panel').style.display = 'none';
        document.getElementById('relatorios-panel').style.display = '';
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-relatorios').classList.add('active');
        gerarRelatorio();
    };

    window.gerarRelatorio = async function() {
        const periodo = document.getElementById('relatorio-periodo').value;
        const mesSel = parseInt(document.getElementById('relatorio-mes').value);
        const anoSel = parseInt(document.getElementById('relatorio-ano').value);

        // Buscar pagamentos do banco para dados de empréstimos
        const loanIds = loans.map(l => l.id);
        let allPagamentos = [];
        if (loanIds.length > 0) {
            const { data: pagData } = await supabase
                .from('pagamentos')
                .select('*')
                .in('loan_id', loanIds)
                .order('data_vencimento', { ascending: true });
            allPagamentos = pagData || [];
        }

        const mesesNomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const mesesCompletos = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

        // Calcular receitas mensais baseado nas datas de empréstimo (loans.data)
        const receitasMensais = {};
        const lucrosMensais = {};
        const atrasadosMensais = {};
        const today = new Date().toISOString().split('T')[0];

        // Empréstimos por mês de criação/vencimento
        loans.forEach(loan => {
            const [ano, mes] = loan.data.split('-').map(Number);
            const key = `${ano}-${String(mes).padStart(2, '0')}`;
            if (!receitasMensais[key]) receitasMensais[key] = { emprestimos: 0, rendas: 0, lucro: 0, atrasados: 0 };

            receitasMensais[key].emprestimos += loan.totalAPagar;
            receitasMensais[key].lucro += (loan.totalAPagar - loan.valor);

            // Verificar se está atrasado
            let temAtraso = false;
            if (loan.frequencia !== 'unique' && loan.pagamentos) {
                temAtraso = loan.pagamentos.some(p => !p.pago && p.dataVencimento < today);
            } else {
                temAtraso = !loan.pago && loan.data < today;
            }
            if (temAtraso) {
                receitasMensais[key].atrasados += loan.totalAPagar;
            }
        });

        // Outras rendas por mês
        rendas.forEach(r => {
            const [ano, mes] = r.data.split('-').map(Number);
            const key = `${ano}-${String(mes).padStart(2, '0')}`;
            if (!receitasMensais[key]) receitasMensais[key] = { emprestimos: 0, rendas: 0, lucro: 0, atrasados: 0 };
            receitasMensais[key].rendas += r.valor;
        });

        // Gerar labels e dados conforme período
        let labels = [];
        let emprestimosData = [];
        let rendasData = [];
        let lucroData = [];
        let atrasadosData = [];
        let totalEmp = 0, totalRnd = 0, totalLuc = 0, totalAtr = 0;

        if (periodo === 'mensal') {
            // Filtrar apenas o mês selecionado, mas mostrar todos os meses do ano
            for (let m = 0; m < 12; m++) {
                const key = `${anoSel}-${String(m + 1).padStart(2, '0')}`;
                const dados = receitasMensais[key] || { emprestimos: 0, rendas: 0, lucro: 0, atrasados: 0 };
                labels.push(mesesNomes[m]);
                emprestimosData.push(dados.emprestimos);
                rendasData.push(dados.rendas);
                lucroData.push(dados.lucro);
                atrasadosData.push(dados.atrasados);

                if (m === mesSel) {
                    totalEmp = dados.emprestimos;
                    totalRnd = dados.rendas;
                    totalLuc = dados.lucro;
                    totalAtr = dados.atrasados;
                }
            }
        } else {
            // Anual: últimos 12 meses
            const ahora = new Date();
            for (let i = 11; i >= 0; i--) {
                const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const dados = receitasMensais[key] || { emprestimos: 0, rendas: 0, lucro: 0, atrasados: 0 };
                labels.push(`${mesesNomes[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`);
                emprestimosData.push(dados.emprestimos);
                rendasData.push(dados.rendas);
                lucroData.push(dados.lucro);
                atrasadosData.push(dados.atrasados);

                totalEmp += dados.emprestimos;
                totalRnd += dados.rendas;
                totalLuc += dados.lucro;
                totalAtr += dados.atrasados;
            }
        }

        // Atualizar KPIs
        document.getElementById('rel-emprestimos').textContent = `R$ ${totalEmp.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        document.getElementById('rel-rendas').textContent = `R$ ${totalRnd.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        document.getElementById('rel-lucro').textContent = `R$ ${totalLuc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        document.getElementById('rel-atrasados').textContent = `R$ ${totalAtr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

        // Tabela detalhada
        const relatorioList = document.getElementById('relatorio-list');
        const relatorioEmpty = document.getElementById('relatorio-empty');
        relatorioList.innerHTML = '';

        let hasData = false;
        labels.forEach((label, i) => {
            const emp = emprestimosData[i];
            const rnd = rendasData[i];
            const luc = lucroData[i];
            const atr = atrasadosData[i];
            if (emp > 0 || rnd > 0) {
                hasData = true;
                const tr = document.createElement('tr');
                const total = emp + rnd;
                tr.innerHTML = `
                    <td><strong>${periodo === 'mensal' ? mesesCompletos[i] + ' ' + anoSel : label}</strong></td>
                    <td style="color:#3b82f6;font-weight:600;">R$ ${emp.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td style="color:#f59e0b;font-weight:600;">R$ ${rnd.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td style="font-weight:700;">R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td style="color:#10b981;font-weight:600;">R$ ${luc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td style="color:${atr > 0 ? '#ef4444' : 'var(--text-muted)'};font-weight:600;">R$ ${atr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                `;
                relatorioList.appendChild(tr);
            }
        });

        relatorioEmpty.style.display = hasData ? 'none' : 'block';

        // ---- GRÁFICO EVOLUÇÃO MENSAL ----
        const ctxEvolucao = document.getElementById('evolucaoChart').getContext('2d');
        const isDark3 = !document.body.getAttribute('data-theme') || document.body.getAttribute('data-theme') === 'dark';
        const textColor3 = isDark3 ? '#94a3b8' : '#64748b';
        const gridColor3 = isDark3 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

        if (evolucaoChart) {
            evolucaoChart.data.labels = labels;
            evolucaoChart.data.datasets[0].data = emprestimosData;
            evolucaoChart.data.datasets[1].data = rendasData;
            evolucaoChart.data.datasets[2].data = atrasadosData;
            evolucaoChart.options.scales.x.ticks.color = textColor3;
            evolucaoChart.options.scales.y.ticks.color = textColor3;
            evolucaoChart.update();
        } else {
            evolucaoChart = new Chart(ctxEvolucao, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Empréstimos',
                            data: emprestimosData,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            fill: true,
                            tension: 0.4,
                            borderWidth: 3,
                            pointRadius: 5,
                            pointHoverRadius: 8,
                            pointBackgroundColor: '#3b82f6',
                            pointBorderColor: isDark3 ? '#111827' : '#ffffff',
                            pointBorderWidth: 2
                        },
                        {
                            label: 'Outras Rendas',
                            data: rendasData,
                            borderColor: '#f59e0b',
                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                            fill: true,
                            tension: 0.4,
                            borderWidth: 3,
                            pointRadius: 5,
                            pointHoverRadius: 8,
                            pointBackgroundColor: '#f59e0b',
                            pointBorderColor: isDark3 ? '#111827' : '#ffffff',
                            pointBorderWidth: 2
                        },
                        {
                            label: 'Atrasados',
                            data: atrasadosData,
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.05)',
                            fill: true,
                            tension: 0.4,
                            borderWidth: 2,
                            borderDash: [5, 5],
                            pointRadius: 4,
                            pointHoverRadius: 7,
                            pointBackgroundColor: '#ef4444',
                            pointBorderColor: isDark3 ? '#111827' : '#ffffff',
                            pointBorderWidth: 2
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { labels: { color: textColor3, font: { family: 'Inter', size: 11, weight: 500 }, padding: 16, usePointStyle: true, pointStyleWidth: 10 } },
                        tooltip: {
                            backgroundColor: isDark3 ? '#1e293b' : '#ffffff',
                            titleColor: isDark3 ? '#f1f5f9' : '#0f172a',
                            bodyColor: isDark3 ? '#94a3b8' : '#64748b',
                            borderColor: isDark3 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                            borderWidth: 1,
                            padding: 14,
                            cornerRadius: 10,
                            displayColors: true,
                            boxPadding: 4,
                            callbacks: { label: ctx => `${ctx.dataset.label}: R$ ${ctx.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }
                        }
                    },
                    scales: {
                        x: { ticks: { color: textColor3, font: { family: 'Inter', weight: 500 } }, grid: { color: gridColor3 }, border: { display: false } },
                        y: { ticks: { color: textColor3, callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter' } }, grid: { color: gridColor3 }, border: { display: false } }
                    }
                }
            });
        }

        // ---- GRÁFICO LUCRO MENSAL ----
        const ctxLucro = document.getElementById('lucroMensalChart').getContext('2d');

        if (lucroMensalChart) {
            lucroMensalChart.data.labels = labels;
            lucroMensalChart.data.datasets[0].data = lucroData;
            lucroMensalChart.update();
        } else {
            lucroMensalChart = new Chart(ctxLucro, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Lucro',
                        data: lucroData,
                        backgroundColor: 'rgba(16, 185, 129, 0.7)',
                        borderColor: '#10b981',
                        borderWidth: 2,
                        borderRadius: 6,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: isDark3 ? '#1e293b' : '#ffffff',
                            titleColor: isDark3 ? '#f1f5f9' : '#0f172a',
                            bodyColor: isDark3 ? '#94a3b8' : '#64748b',
                            borderColor: isDark3 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                            borderWidth: 1,
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: { label: ctx => 'R$ ' + ctx.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) }
                        }
                    },
                    scales: {
                        x: { ticks: { color: textColor3, font: { family: 'Inter', weight: 500 } }, grid: { display: false }, border: { display: false } },
                        y: { ticks: { color: textColor3, callback: v => 'R$ ' + v.toLocaleString('pt-BR'), font: { family: 'Inter' } }, grid: { color: gridColor3 }, border: { display: false } }
                    }
                }
            });
        }

        // ---- GRÁFICO COMPOSIÇÃO ----
        const ctxComposicao = document.getElementById('composicaoChart').getContext('2d');
        const totalEmpGeral = emprestimosData.reduce((a, b) => a + b, 0);
        const totalRndGeral = rendasData.reduce((a, b) => a + b, 0);
        const totalLucGeral = lucroData.reduce((a, b) => a + b, 0);
        const totalAtrGeral = atrasadosData.reduce((a, b) => a + b, 0);

        if (composicaoChart) {
            composicaoChart.data.datasets[0].data = [totalEmpGeral, totalRndGeral, totalLucGeral, totalAtrGeral];
            composicaoChart.update();
        } else {
            composicaoChart = new Chart(ctxComposicao, {
                type: 'doughnut',
                data: {
                    labels: ['Empréstimos', 'Outras Rendas', 'Lucro (Juros)', 'Atrasados'],
                    datasets: [{
                        data: [totalEmpGeral, totalRndGeral, totalLucGeral, totalAtrGeral],
                        backgroundColor: ['rgba(59, 130, 246, 0.8)', 'rgba(245, 158, 11, 0.8)', 'rgba(16, 185, 129, 0.8)', 'rgba(239, 68, 68, 0.8)'],
                        borderColor: isDark3 ? '#111827' : '#ffffff',
                        borderWidth: 3,
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '60%',
                    plugins: {
                        legend: { position: 'right', labels: { color: textColor3, font: { family: 'Inter', size: 11 }, padding: 12, usePointStyle: true, pointStyleWidth: 10 } },
                        tooltip: {
                            backgroundColor: isDark3 ? '#1e293b' : '#ffffff',
                            titleColor: isDark3 ? '#f1f5f9' : '#0f172a',
                            bodyColor: isDark3 ? '#94a3b8' : '#64748b',
                            borderColor: isDark3 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                            borderWidth: 1,
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: { label: ctx => `${ctx.label}: R$ ${ctx.parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }
                        }
                    }
                }
            });
        }
    };

    document.getElementById('btn-inicio').addEventListener('click', () => {
        mostrarSecoesPrincipais();
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-inicio').classList.add('active');
        if (waPollInterval) clearInterval(waPollInterval);
    });
});

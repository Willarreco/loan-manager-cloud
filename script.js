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

    const loanForm = {
        nome: document.getElementById('cliente-nome'),
        telefone: document.getElementById('cliente-telefone'),
        valor: document.getElementById('valor-pego'),
        juros: document.getElementById('valor-juros'),
        tipoJuros: document.getElementById('tipo-juros'),
        cobrado: document.getElementById('valor-cobrado'),
        data: document.getElementById('data-pagamento'),
        frequencia: document.getElementById('frequencia'),
        valorParcela: document.getElementById('valor-parcela-input')
    };
    const addBtn = document.getElementById('add-client-btn');
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

    loadLoans();

    if (!addBtn) { console.error('Botao add-client-btn nao encontrado!'); } else { addBtn.addEventListener('click', addLoan); }
    themeSelect.addEventListener('change', toggleTheme);
    reportBtn.addEventListener('click', () => alert('Funcionalidade de Relatório PDF em desenvolvimento.'));

    const parcelasPreview = document.getElementById('parcelas-preview');
    const autoNotifyCheck = document.getElementById('auto-notify');
    const autoNotifyGroup = document.getElementById('auto-notify-group');
    const diaSemanaGroup = document.getElementById('dia-semana-group');
    const diaSemana = document.getElementById('dia-semana');
    const diaMes = document.getElementById('dia-mes');

    // Popular select dia do mês (1-31)
    for (let d = 1; d <= 31; d++) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = `Dia ${d}`;
        diaMes.appendChild(opt);
    }

    function atualizarPreviewParcelas() {
        const valor = parseFloat(loanForm.valor.value) || 0;
        const juros = parseFloat(loanForm.juros.value) || 0;
        const tipoJuros = loanForm.tipoJuros.value;
        const cobrado = parseFloat(loanForm.cobrado.value) || 0;
        const valorParcela = parseFloat(loanForm.valorParcela.value) || 0;
        const freq = loanForm.frequencia.value;
        const valorJuros = tipoJuros === 'percent' ? (valor * (juros / 100)) : juros;
        const total = valor + valorJuros + cobrado;

        if ((freq === 'weekly' || freq === 'monthly' || freq === 'juros_only') && valorParcela > 0 && total > 0) {
            const numParcelas = Math.ceil(total / valorParcela);
            let diaInfo = '';
            if (freq === 'weekly' || freq === 'juros_only') {
                const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
                diaInfo = ` todo(a) ${dias[parseInt(diaSemana.value)]}`;
            } else {
                diaInfo = ` todo dia ${diaMes.value}`;
            }
            const freqLabel = freq === 'weekly' ? 'semana' : (freq === 'juros_only' ? 'semana' : 'mês');
            const freqLabelPlural = freq === 'weekly' ? 'semanas' : (freq === 'juros_only' ? 'semanas (juros)' : 'meses');
            const prefixo = freq === 'juros_only' ? 'Juros: ' : '';
            parcelasPreview.textContent = `${prefixo}${numParcelas} ${numParcelas === 1 ? freqLabel : freqLabelPlural}${diaInfo} = R$ ${(numParcelas * valorParcela).toFixed(2)}`;
        } else {
            parcelasPreview.textContent = '';
        }
    }

    // Mostrar/esconder campos conforme frequência
    loanForm.frequencia.addEventListener('change', () => {
        const freq = loanForm.frequencia.value;
        const showParcelas = freq === 'weekly' || freq === 'monthly' || freq === 'juros_only';
        autoNotifyGroup.style.display = showParcelas ? 'block' : 'none';
        parcelasGroup.style.display = showParcelas ? 'block' : 'none';
        diaSemanaGroup.style.display = (freq === 'weekly' || freq === 'juros_only') ? 'block' : 'none';
        diaMesGroup.style.display = freq === 'monthly' ? 'block' : 'none';
        if (freq === 'unique') {
            loanForm.valorParcela.value = '';
            parcelasPreview.textContent = '';
        }
        atualizarPreviewParcelas();
    });

    loanForm.valor.addEventListener('input', atualizarPreviewParcelas);
    loanForm.juros.addEventListener('input', atualizarPreviewParcelas);
    loanForm.tipoJuros.addEventListener('change', atualizarPreviewParcelas);
    loanForm.cobrado.addEventListener('input', atualizarPreviewParcelas);
    loanForm.valorParcela.addEventListener('input', atualizarPreviewParcelas);
    diaSemana.addEventListener('change', atualizarPreviewParcelas);
    diaMes.addEventListener('change', atualizarPreviewParcelas);

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
                juros: parseFloat(l.juros),
                tipoJuros: l.tipo_juros || 'percent',
                cobrado: parseFloat(l.valor_cobrado || 0),
                totalAPagar: parseFloat(l.total_a_pagar),
                data: l.data_pagamento,
                frequencia: l.frequencia || 'unique',
                numeroParcelas: l.numero_parcelas || null,
                valorParcela: l.valor_parcela ? parseFloat(l.valor_parcela) : null,
                diaVencimento: l.dia_vencimento,
                autoNotify: l.auto_notify || false,
                pago: l.pago || false
            }));
            // Carregar pagamentos para todos os empréstimos
            await loadAllPagamentos();
            renderLoans();
            checkExpirations();
            checkAutomaticNotifications();
        }
    }

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
            const nome = loanForm.nome.value.trim();
            const telefone = loanForm.telefone.value.trim();
            const valor = parseFloat(loanForm.valor.value);
            const juros = parseFloat(loanForm.juros.value);
            const tipoJuros = loanForm.tipoJuros.value;
            const cobrado = parseFloat(loanForm.cobrado.value) || 0;
            const data = loanForm.data.value;
            const frequencia = loanForm.frequencia.value;

            if (!nome || !telefone || isNaN(valor) || isNaN(juros) || !data) {
                alert('Preencha todos os campos obrigatórios.');
                return;
            }

            const valorJuros = tipoJuros === 'percent' ? (valor * (juros / 100)) : juros;
            const totalAPagar = valor + valorJuros + cobrado;

            let numParcelas = null;
            let valParcela = null;
            let diaVencto = null;
            const isParcelado = frequencia === 'weekly' || frequencia === 'monthly' || frequencia === 'juros_only';
            if (isParcelado) {
                valParcela = parseFloat(loanForm.valorParcela.value) || 0;
                if (valParcela <= 0) { alert('Informe o valor da parcela.'); return; }
                numParcelas = Math.ceil(totalAPagar / valParcela);
                if (numParcelas < 2) { alert('Valor da parcela muito alto.'); return; }
                diaVencto = (frequencia === 'weekly' || frequencia === 'juros_only') ? parseInt(diaSemana.value) : parseInt(diaMes.value);
            }

            const autoNotify = isParcelado ? autoNotifyCheck.checked : false;
            const payload = {
                user_id: user.id, nome, telefone, valor, juros,
                tipo_juros: tipoJuros, valor_cobrado: cobrado,
                total_a_pagar: totalAPagar, data_pagamento: data,
                frequencia, numero_parcelas: numParcelas,
                valor_parcela: valParcela,
                auto_notify: autoNotify
            };
            if (diaVencto !== null) payload.dia_vencimento = diaVencto;

            if (editingLoanId) {
                const { error } = await supabase.from('loans').update(payload).eq('id', editingLoanId);
                if (error) { alert('Erro ao atualizar: ' + error.message); return; }
                if (frequencia !== 'unique' && numParcelas) {
                    await deletePagamentosDoLoan(editingLoanId);
                    await gerarParcelas(editingLoanId, valParcela, numParcelas, frequencia, totalAPagar, valorJuros);
                } else if (frequencia === 'unique') {
                    await deletePagamentosDoLoan(editingLoanId);
                }
                editingLoanId = null;
                addBtn.textContent = 'Adicionar Novo Cliente';
                addBtn.classList.remove('success-btn');
                addBtn.classList.add('primary-btn');
                loadLoans();
                clearForm();
            } else {
                const { data: result, error } = await supabase.from('loans').insert([payload]).select();
                if (error) { alert('Erro ao salvar: ' + error.message); return; }
                if (!result || result.length === 0) { alert('Erro: banco não retornou dados.'); return; }
                const loanId = result[0].id;
                if (frequencia !== 'unique' && numParcelas) {
                    await gerarParcelas(loanId, valParcela, numParcelas, frequencia, totalAPagar, valorJuros);
                }
                loadLoans();
                clearForm();
            }
        } catch (e) {
            alert('Erro inesperado: ' + e.message);
            console.error(e);
        }
    }

    async function gerarParcelas(loanId, valParcela, totalParcelas, frequencia, totalAPagar, valorJuros) {
        try {
            const parcelas = [];
            const hoje = new Date();
            const valorJurosParcela = valorJuros / totalParcelas;

            for (let i = 0; i < totalParcelas; i++) {
                const dataParcela = new Date(hoje);
                const isWeekly = frequencia === 'weekly' || frequencia === 'juros_only';
                if (isWeekly) {
                    const diaSemanaIdx = parseInt(diaSemana.value);
                    const diff = diaSemanaIdx - dataParcela.getDay();
                    dataParcela.setDate(dataParcela.getDate() + diff + (i * 7));
                } else {
                    const diaMesIdx = parseInt(diaMes.value);
                    dataParcela.setDate(diaMesIdx);
                    dataParcela.setMonth(dataParcela.getMonth() + i);
                    if (dataParcela.getDate() !== diaMesIdx) {
                        dataParcela.setDate(0);
                    }
                }

                if (frequencia === 'juros_only') {
                    const valor = (i === totalParcelas - 1)
                        ? Math.round((valorJuros - (valorJurosParcela * (totalParcelas - 1))) * 100) / 100
                        : Math.round(valorJurosParcela * 100) / 100;
                    parcelas.push({
                        loan_id: loanId,
                        data_vencimento: dataParcela.toISOString().split('T')[0],
                        valor,
                        pago: false,
                        tipo: 'juros'
                    });
                } else {
                    const ultimaParcela = totalAPagar - (valParcela * (totalParcelas - 1));
                    const valor = (i === totalParcelas - 1) ? ultimaParcela : valParcela;
                    parcelas.push({
                        loan_id: loanId,
                        data_vencimento: dataParcela.toISOString().split('T')[0],
                        valor: Math.round(valor * 100) / 100,
                        pago: false
                    });
                }
            }

            // Para juros_only, adicionar parcela do principal
            if (frequencia === 'juros_only') {
                parcelas.push({
                    loan_id: loanId,
                    data_vencimento: hoje.toISOString().split('T')[0],
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

    async function deletePagamentosDoLoan(loanId) {
        try {
            const { error } = await supabase.from('pagamentos').delete().eq('loan_id', loanId);
            if (error) console.warn('Erro ao remover parcelas antigas:', error.message);
        } catch (e) {
            console.warn('Erro ao remover parcelas:', e.message);
        }
    }

    async function deleteLoan(id) {
        if (confirm('Tem certeza que deseja excluir este registro?')) {
            await deletePagamentosDoLoan(id);
            const { error } = await supabase
                .from('loans')
                .delete()
                .eq('id', id);

            if (error) {
                alert('Erro ao excluir: ' + error.message);
            } else {
                loadLoans();
            }
        }
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
            tr.innerHTML = `
                <td><strong>${loan.nome}</strong></td>
                <td>${loan.telefone}</td>
                <td>R$ ${loan.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td>${loan.tipoJuros === 'percent' ? loan.juros + '%' : 'R$ ' + loan.juros.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td>R$ ${loan.cobrado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style="color: #4facfe; font-weight: bold;">R$ ${loan.totalAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style="font-size:0.85rem;">${parcelasInfo}</td>
                <td>
                    ${formatDate(loan.data)} 
                    <span class="status-badge ${statusClasse}">${statusTexto}</span>
                </td>
                <td>
                    <button class="whatsapp-btn" onclick="notifyClient('${loan.id}')">Notificar</button>
                    ${loan.frequencia !== 'unique' ? `<button class="parcelas-btn" onclick="abrirModalParcelas('${loan.id}')"><i class="fas fa-list"></i></button>` : ''}
                    ${loan.frequencia === 'juros_only' ? `<button class="edit-btn" style="background:#6f42c1;color:#fff;" onclick="pagarPrincipal('${loan.id}')">Principal</button>` : ''}
                    ${loan.frequencia === 'unique' ? (loan.pago ? '' : `<button class="success-btn" style="padding:0.3rem 0.5rem;font-size:0.75rem;" onclick="marcarPagoUnico('${loan.id}')">Pagar</button>`) : ''}
                    <button class="edit-btn" onclick="editLoan('${loan.id}')">Editar</button>
                    <button class="danger-btn" onclick="deleteLoan('${loan.id}')">Excluir</button>
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

    function autoNotificarCliente(loan, parcela) {
        const nome = loan.nome.split(' ')[0];
        let message = `Bom dia! Tudo bem?\n\n${nome}, passando para lembrar que hoje vence o seu compromisso de pagamento.\n\n`;
        if (parcela) {
            message += `Você pode realizar o pagamento do valor total da dívida (parcela de R$ ${parcela.valor.toLocaleString('pt-BR')}) ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros.`;
        } else {
            message += `Você pode realizar o pagamento do valor total da dívida (R$ ${loan.totalAPagar.toLocaleString('pt-BR')}) ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros.`;
        }
        message += `\n\nCaso tenhamos um acordo diferente, desconsidere esta mensagem e siga as condições previamente acertadas.\n\nQualquer dúvida, estou à disposição. Obrigado!`;
        const url = `https://wa.me/${loan.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
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

    // Fechar modal clicando fora
    document.addEventListener('click', (e) => {
        const modal = document.getElementById('parcelas-modal');
        if (e.target === modal) modal.style.display = 'none';
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
        const borderColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

        if (loanChart) {
            loanChart.data.labels = clientLabels;
            loanChart.data.datasets[0].data = clientProfitValues;
            loanChart.options.plugins.legend.labels.color = textColor;
            loanChart.update();
        } else {
            loanChart = new Chart(ctxLoan, {
                type: 'pie',
                data: {
                    labels: clientLabels,
                    datasets: [{
                        data: clientProfitValues,
                        backgroundColor: chartColors,
                        borderWidth: 3,
                        borderColor: isDark ? '#111827' : '#ffffff',
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: { color: textColor, font: { size: 11, family: 'Inter' }, padding: 12, usePointStyle: true, pointStyleWidth: 10 } },
                        tooltip: { backgroundColor: isDark ? '#1e293b' : '#ffffff', titleColor: isDark ? '#f1f5f9' : '#0f172a', bodyColor: isDark ? '#94a3b8' : '#64748b', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: true, boxPadding: 4 }
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
        const nome = loan.nome.split(' ')[0];
        let message = `Bom dia! Tudo bem?\n\n${nome}, passando para lembrar que hoje vence o seu compromisso de pagamento.\n\n`;
        let valorParcela = 0;
        if (loan.frequencia !== 'unique' && loan.pagamentos) {
            const pendentes = loan.pagamentos.filter(p => !p.pago);
            if (pendentes.length > 0) {
                const prox = pendentes[0];
                valorParcela = prox.valor;
                message += `Você pode realizar o pagamento do valor total da dívida (parcela de R$ ${prox.valor.toLocaleString('pt-BR')}) ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros.`;
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
            message += `Você pode realizar o pagamento do valor total da dívida (R$ ${loan.totalAPagar.toLocaleString('pt-BR')}) ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros.`;
            loan._whatsappEnviado = true;
        }
        if (!message.startsWith('Olá')) {
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
        const today = new Date().toISOString().split('T')[0];
        if (dateStr < today) return 'overdue';
        if (dateStr === today) return 'today';
        return 'upcoming';
    }

    function statusText(status) {
        if (status === 'overdue') return 'ATRASADO';
        if (status === 'today') return 'VENCE HOJE';
        return 'NO PRAZO';
    }

    async function marcarPagoUnico(id) {
        if (!confirm('Marcar este empréstimo como PAGO?')) return;
        const { error } = await supabase.from('loans').update({ pago: true }).eq('id', id);
        if (error) { alert('Erro ao marcar como pago: ' + error.message); return; }
        loadLoans();
    }

    function editLoan(id) {
        const loan = loans.find(l => l.id == id);
        if (!loan) return;

        editingLoanId = id;
        loanForm.nome.value = loan.nome;
        loanForm.telefone.value = loan.telefone;
        loanForm.valor.value = loan.valor;
        loanForm.juros.value = loan.juros;
        loanForm.tipoJuros.value = loan.tipoJuros;
        loanForm.cobrado.value = loan.cobrado;
        loanForm.data.value = loan.data;
        loanForm.frequencia.value = loan.frequencia || 'unique';
        if (loan.valorParcela) {
            loanForm.valorParcela.value = loan.valorParcela;
        } else {
            loanForm.valorParcela.value = '';
        }
        autoNotifyCheck.checked = loan.autoNotify || false;
        // Disparar change para atualizar campos de frequencia
        loanForm.frequencia.dispatchEvent(new Event('change'));

        addBtn.textContent = 'Salvar Alterações';
        addBtn.classList.remove('primary-btn');
        addBtn.classList.add('success-btn');

        window.scrollTo({ top: 0, behavior: 'smooth' });
        loanForm.nome.focus();
    }

    window.deleteLoan = deleteLoan;
    window.editLoan = editLoan;
    window.clearForm = clearForm;

    function clearForm() {
        editingLoanId = null;
        addBtn.textContent = 'Adicionar Novo Cliente';
        addBtn.classList.remove('success-btn');
        addBtn.classList.add('primary-btn');

        loanForm.nome.value = '';
        loanForm.telefone.value = '';
        loanForm.valor.value = '';
        loanForm.juros.value = '';
        loanForm.cobrado.value = '';
        loanForm.data.value = '';
        loanForm.frequencia.value = 'unique';
        loanForm.valorParcela.value = '';
        autoNotifyCheck.checked = true;
        autoNotifyGroup.style.display = 'none';
        parcelasGroup.style.display = 'none';
        diaSemanaGroup.style.display = 'none';
        diaMesGroup.style.display = 'none';
        diaSemana.value = '0';
        diaMes.value = '1';
        parcelasPreview.textContent = '';
        atualizarPreviewParcelas();
        loanForm.nome.focus();
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    }

    function toggleTheme() {
        const theme = themeSelect.value;
        document.body.setAttribute('data-theme', theme);
    }

    // Navegação
    function mostrarSecoesPrincipais() {
        document.getElementById('wa-panel').style.display = 'none';
        document.getElementById('rendas-panel').style.display = 'none';
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
            console.error('Erro ao carregar rendas:', error.message);
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
            const { error } = await supabase.from('rendas').update(payload).eq('id', editingRendaId);
            if (error) { alert('Erro ao atualizar: ' + error.message); return; }
            editingRendaId = null;
            addRendaBtn.textContent = 'Adicionar Renda';
            addRendaBtn.classList.remove('success-btn');
            addRendaBtn.classList.add('primary-btn');
        } else {
            const { error } = await supabase.from('rendas').insert([payload]);
            if (error) { alert('Erro ao salvar: ' + error.message); return; }
        }

        clearRendaForm();
        loadRendas();
    }

    window.editarRenda = function(id) {
        const renda = rendas.find(r => r.id == id);
        if (!renda) return;

        editingRendaId = id;
        rendaForm.nome.value = renda.nome;
        rendaForm.valor.value = renda.valor;
        rendaForm.data.value = renda.data;
        rendaForm.tipo.value = renda.tipo;
        rendaForm.recorrente.checked = renda.recorrente;
        rendaForm.observacao.value = renda.observacao;

        addRendaBtn.textContent = 'Salvar Alterações';
        addRendaBtn.classList.remove('primary-btn');
        addRendaBtn.classList.add('success-btn');
        rendaForm.nome.focus();
    };

    window.excluirRenda = async function(id) {
        if (!confirm('Tem certeza que deseja excluir esta renda?')) return;
        const { error } = await supabase.from('rendas').delete().eq('id', id);
        if (error) { alert('Erro ao excluir: ' + error.message); return; }
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
                    <button class="edit-btn" onclick="editarRenda(${renda.id})">Editar</button>
                    <button class="danger-btn" onclick="excluirRenda(${renda.id})">Excluir</button>
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

    document.getElementById('btn-inicio').addEventListener('click', () => {
        mostrarSecoesPrincipais();
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-inicio').classList.add('active');
        if (waPollInterval) clearInterval(waPollInterval);
    });
});

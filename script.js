console.log('script.js carregou!');
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOMContentLoaded disparou!');
    const session = await checkSession();
    console.log('Session:', session ? 'OK' : 'null');
    if (!session) { console.log('Sem session, abortando'); return; }

    const supabase = window.supabaseClient;
    const user = session.user;

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
                autoNotify: l.auto_notify || false
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

            if (status === 'overdue') tr.classList.add('row-overdue');
            if (status === 'today') tr.classList.add('row-due-today');

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
                    <span class="status-badge status-${status}">${statusText(status)}</span>
                </td>
                <td>
                    <button class="whatsapp-btn" onclick="notifyClient('${loan.id}')">Notificar</button>
                    ${loan.frequencia !== 'unique' ? `<button class="parcelas-btn" onclick="abrirModalParcelas('${loan.id}')"><i class="fas fa-list"></i></button>` : ''}
                    ${loan.frequencia === 'juros_only' ? `<button class="edit-btn" style="background:#6f42c1;color:#fff;" onclick="pagarPrincipal('${loan.id}')">Principal</button>` : ''}
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
            return loan.data === today;
        });
        const overdue = loans.filter(loan => {
            if (loan.frequencia !== 'unique' && loan.pagamentos) {
                return loan.pagamentos.some(p => !p.pago && p.tipo !== 'principal' && p.dataVencimento < today);
            }
            return loan.data < today;
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
            let temAtraso = status === 'overdue';
            if (loan.frequencia !== 'unique' && loan.pagamentos) {
                temAtraso = loan.pagamentos.some(p => !p.pago && p.dataVencimento < new Date().toISOString().split('T')[0]);
            }
            if (temAtraso) {
                totalAtraso += loan.totalAPagar;
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
        if (loanChart) {
            loanChart.data.labels = clientLabels;
            loanChart.data.datasets[0].data = clientProfitValues;
            loanChart.update();
        } else {
            loanChart = new Chart(ctxLoan, {
                type: 'pie',
                data: {
                    labels: clientLabels,
                    datasets: [{
                        data: clientProfitValues,
                        backgroundColor: ['#007bff', '#28a745', '#17a2b8', '#ffc107', '#dc3545', '#6610f2', '#e83e8c', '#fd7e14', '#20c997', '#6f42c1'],
                        borderWidth: 2,
                        borderColor: '#1e1e1e'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: { color: '#b0b0b0', font: { size: 10 } } }
                    }
                }
            });
        }

        const ctxStatus = document.getElementById('statusChart').getContext('2d');
        const statusData = [statusCounts.overdue, statusCounts.today, statusCounts.upcoming];
        const statusLabels = ['Atrasado', 'Vence Hoje', 'No Prazo'];

        if (statusChart) {
            statusChart.data.datasets[0].data = statusData;
            statusChart.update();
        } else {
            statusChart = new Chart(ctxStatus, {
                type: 'doughnut',
                data: {
                    labels: statusLabels,
                    datasets: [{
                        data: statusData,
                        backgroundColor: ['#dc3545', '#ffc107', '#28a745'],
                        borderWidth: 2,
                        borderColor: '#1e1e1e'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: {
                        legend: { position: 'right', labels: { color: '#b0b0b0', font: { size: 10 } } }
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
        if (loan.frequencia !== 'unique' && loan.pagamentos) {
            const pendentes = loan.pagamentos.filter(p => !p.pago);
            if (pendentes.length > 0) {
                const prox = pendentes[0];
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
            message += `Você pode realizar o pagamento do valor total da dívida (R$ ${loan.totalAPagar.toLocaleString('pt-BR')}) ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros.`;
            loan._whatsappEnviado = true;
        }
        if (!message.startsWith('Olá')) {
            message += `\n\nCaso tenhamos um acordo diferente, desconsidere esta mensagem e siga as condições previamente acertadas.\n\nQualquer dúvida, estou à disposição. Obrigado!`;
        }
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
        const isParceladoEdit = loan.frequencia !== 'unique';
        if (isParceladoEdit) autoNotifyGroup.style.display = 'block';
        if (loan.valorParcela) {
            loanForm.valorParcela.value = loan.valorParcela;
            autoNotifyCheck.checked = loan.autoNotify || false;
            parcelasGroup.style.display = 'block';
            if (loan.frequencia === 'weekly' || loan.frequencia === 'juros_only') {
                diaSemanaGroup.style.display = 'block';
                diaSemana.value = loan.diaVencimento || 0;
            } else if (loan.frequencia === 'monthly') {
                diaMesGroup.style.display = 'block';
                diaMes.value = loan.diaVencimento || 1;
            }
        } else {
            loanForm.valorParcela.value = '';
            parcelasGroup.style.display = 'none';
            diaSemanaGroup.style.display = 'none';
            diaMesGroup.style.display = 'none';
        }

        addBtn.textContent = 'Salvar Alterações';
        addBtn.classList.remove('primary-btn');
        addBtn.classList.add('success-btn');

        window.scrollTo({ top: 0, behavior: 'smooth' });
        loanForm.nome.focus();
    }

    window.deleteLoan = deleteLoan;
    window.editLoan = editLoan;

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
});

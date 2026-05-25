document.addEventListener('DOMContentLoaded', async () => {
    // Verificar sessão antes de carregar dados
    const session = await checkSession();
    if (!session) return;

    const supabase = window.supabaseClient;
    const user = session.user;

    const loanForm = {
        nome: document.getElementById('cliente-nome'),
        telefone: document.getElementById('cliente-telefone'),
        valor: document.getElementById('valor-pego'),
        juros: document.getElementById('valor-juros'),
        tipoJuros: document.getElementById('tipo-juros'),
        cobrado: document.getElementById('valor-cobrado'),
        data: document.getElementById('data-pagamento')
    };
    const addBtn = document.getElementById('add-client-btn');
    const loanList = document.getElementById('loan-list');
    const emptyState = document.getElementById('empty-state');
    const themeSelect = document.getElementById('theme-select');
    const reportBtn = document.getElementById('generate-report-btn');
    const alertsBar = document.getElementById('expiration-alerts');

    const ADMIN_PHONE = '027997200333';

    let loans = [];
    let editingLoanId = null;
    let loanChart = null;
    let statusChart = null;

    // Initialize
    loadLoans();

    // Event Listeners
    addBtn.addEventListener('click', addLoan);
    themeSelect.addEventListener('change', toggleTheme);
    reportBtn.addEventListener('click', () => alert('Funcionalidade de Relatório PDF em desenvolvimento.'));

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
                data: l.data_pagamento
            }));
            renderLoans();
            checkExpirations();
        }
    }
    async function addLoan() {
        const nome = loanForm.nome.value.trim();
        const telefone = loanForm.telefone.value.trim();
        const valor = parseFloat(loanForm.valor.value);
        const juros = parseFloat(loanForm.juros.value);
        const tipoJuros = loanForm.tipoJuros.value;
        const cobrado = parseFloat(loanForm.cobrado.value) || 0;
        const data = loanForm.data.value;

        if (!nome || !telefone || isNaN(valor) || isNaN(juros) || !data) {
            alert('Por favor, preencha todos os campos corretamente.');
            return;
        }

        // Cálculo do total a pagar baseado no tipo de juros
        const valorJurosCalculado = tipoJuros === 'percent' ? (valor * (juros / 100)) : juros;
        const totalAPagar = valor + valorJurosCalculado + cobrado;

        if (editingLoanId) {
            const { error } = await supabase
                .from('loans')
                .update({
                    nome,
                    telefone,
                    valor,
                    juros,
                    tipo_juros: tipoJuros,
                    valor_cobrado: cobrado,
                    total_a_pagar: totalAPagar,
                    data_pagamento: data
                })
                .eq('id', editingLoanId);

            if (error) {
                alert('Erro ao atualizar: ' + error.message);
            } else {
                editingLoanId = null;
                addBtn.textContent = 'Adicionar Novo Cliente';
                addBtn.classList.remove('success-btn');
                addBtn.classList.add('primary-btn');
                loadLoans();
                clearForm();
            }
        } else {
            const { data: newEntry, error } = await supabase
                .from('loans')
                .insert([{
                    user_id: user.id,
                    nome,
                    telefone,
                    valor,
                    juros,
                    tipo_juros: tipoJuros,
                    valor_cobrado: cobrado,
                    total_a_pagar: totalAPagar,
                    data_pagamento: data
                }])
                .select();

            if (error) {
                alert('Erro ao salvar no banco de dados: ' + error.message);
            } else {
                loadLoans();
                clearForm();
            }
        }
    }

    async function deleteLoan(id) {
        if (confirm('Tem certeza que deseja excluir este registro?')) {
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

            tr.innerHTML = `
                <td><strong>${loan.nome}</strong></td>
                <td>${loan.telefone}</td>
                <td>R$ ${loan.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td>${loan.tipoJuros === 'percent' ? loan.juros + '%' : 'R$ ' + loan.juros.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td>R$ ${loan.cobrado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style="color: #4facfe; font-weight: bold;">R$ ${loan.totalAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td>
                    ${formatDate(loan.data)} 
                    <span class="status-badge status-${status}">${statusText(status)}</span>
                </td>
                <td>
                    <button class="whatsapp-btn" onclick="notifyClient('${loan.id}')">Notificar</button>
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
        const dueToday = loans.filter(loan => loan.data === today);
        const overdue = loans.filter(loan => loan.data < today);

        if (dueToday.length > 0 || overdue.length > 0) {
            alertsBar.style.display = 'block';
            
            if (overdue.length > 0) {
                const item = document.createElement('div');
                item.className = 'alert-item';
                item.innerHTML = `<span>⚠️ Você tem ${overdue.length} cobrança(s) ATRASADA(S)!</span> <button class="primary-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem;" onclick="notifyAdmin('overdue')">Me Notificar</button>`;
                alertsBar.appendChild(item);
            }

            if (dueToday.length > 0) {
                const item = document.createElement('div');
                item.className = 'alert-item';
                item.style.color = '#ffc107';
                item.innerHTML = `<span>📅 ${dueToday.length} empréstimo(s) vencem HOJE!</span> <button class="primary-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem;" onclick="notifyAdmin('today')">Me Notificar</button>`;
                alertsBar.appendChild(item);
            }
        } else {
            alertsBar.style.display = 'none';
        }
    }

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
            
            if (status === 'overdue') {
                totalAtraso += loan.totalAPagar;
            }

            statusCounts[status]++;
            clientLabels.push(loan.nome);
            clientProfitValues.push(profit);
        });

        // Update KPI Cards
        totalEmprestadoEl.textContent = `R$ ${totalEmprestado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        totalMensalEl.textContent = `R$ ${totalLucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        totalClientesEl.textContent = loans.length;
        totalAtrasoEl.textContent = `R$ ${totalAtraso.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

        // Update / Create Arrecadação Chart
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

        // Update / Create Status Chart
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

    window.notifyClient = (id) => {
        const loan = loans.find(l => l.id == id);
        const message = `Olá ${loan.nome}, lembrete de que seu pagamento de R$ ${loan.totalAPagar.toLocaleString('pt-BR')} vence em ${formatDate(loan.data)}.`;
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
        loanForm.nome.focus();
    }

    function formatDate(dateStr) {
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    }

    function toggleTheme() {
        const theme = themeSelect.value;
        document.body.setAttribute('data-theme', theme);
    }
});

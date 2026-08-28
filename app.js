const { createClient } = window.supabase;
const client = createClient(FUND_CONFIG.supabaseUrl, FUND_CONFIG.supabasePublishableKey);

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n)||0);
const dateText = d => d ? new Date(d).toLocaleDateString('en-IN') : '—';
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const displayMemberCode = (code,name) => { const c=String(code ?? '').trim(); const n=String(name ?? '').trim(); if(!c || !n) return c; const suffix='-'+n; return c.toLowerCase().endsWith(suffix.toLowerCase()) ? c.slice(0,-suffix.length) : c; };
const memberLabel = (member) => `${displayMemberCode(member?.member_code, member?.full_name)} — ${member?.full_name || ''}`;
const emi = (p,r,n) => r === 0 ? p/n : p*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1);
const validMonthlyRate = r => Number.isFinite(r) && r >= 0 && r <= 0.10;
const displayRate = r => validMonthlyRate(r) ? `${(r*100).toFixed(2)}%` : 'Invalid';

let me = null;
let currentMember = null;
let isAdmin = false;
let members = [];
let contributions = [];
let loans = [];
let installments = [];

async function init(){
  const hash = window.location.hash || '';
  const search = window.location.search || '';

  /*
   * Email confirmation callback:
   * Supabase may create a session when the confirmation link
   * is opened. Do not treat that temporary session as a normal
   * application login.
   */
  const isEmailConfirmation =
    hash.includes('type=signup') ||
    hash.includes('type=email_change') ||
    search.includes('type=signup') ||
    search.includes('type=email_change');

  /*
   * Password recovery callback:
   * Show the existing Set New Password screen instead of
   * opening the application.
   */
  const isPasswordRecovery =
    hash.includes('type=recovery') ||
    search.includes('type=recovery');

  if(isPasswordRecovery){
    showLogin('newPassword');
    return;
  }

  if(isEmailConfirmation){
    await client.auth.signOut();

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + window.location.search
    );

    showLogin('login');

    $('authMessage').textContent =
      'Email confirmed successfully. Please sign in with your email and password.';

    return;
  }

  const {data:{session}} = await client.auth.getSession();

  if(session){
    await enterApp();
  }else{
    showLogin('login');
  }
}

function showLogin(view='login'){
  $('app').classList.add('hidden');
  $('loginPanel').classList.remove('hidden');
  $('logoutBtn').classList.add('hidden');
  $('userLabel').textContent='';
  setAuthView(view);
}

function setAuthView(view){
  ['loginView','signupView','forgotView','newPasswordView'].forEach(id=>$(id).classList.add('hidden'));
  const map={login:'loginView',signup:'signupView',forgot:'forgotView',newPassword:'newPasswordView'};
  $(map[view]||map.login).classList.remove('hidden');
  if(view==='login') $('email').focus();
}

function authRedirectUrl(){
  return window.location.origin + window.location.pathname;
}

async function enterApp(){
  const {data:{user}} = await client.auth.getUser();
  if(!user) return showLogin();
  me = user;
  $('loginPanel').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  $('userLabel').textContent = user.email || '';
  const {data:profile} = await client.from('members').select('*').eq('auth_user_id',user.id).maybeSingle();
  if(!profile){ alert('Your login is not linked to a fund member.'); return; }
  currentMember = profile;
  if(profile.status === 'pending'){
    await client.auth.signOut();
    showLogin('login');
    $('authMessage').textContent='Your member account is awaiting Admin approval.';
    return;
  }
  isAdmin = profile.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(x=>x.classList.toggle('hidden',!isAdmin));
  $('welcome').textContent = isAdmin ? 'Admin Dashboard' : `Welcome, ${profile.full_name}`;

  // Always start with Dashboard only. This prevents an Admin-only tab/section
  // from remaining visible because of a stale browser DOM or previous tab state.
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));
  const dashboardTab = document.querySelector('.tabs button[data-tab="dashboard"]');
  if(dashboardTab) dashboardTab.classList.add('active');
  document.querySelectorAll('.tab').forEach(x=>x.classList.add('hidden'));
  $('dashboard').classList.remove('hidden');
  if($('allEmiDetails')) $('allEmiDetails').classList.add('hidden');
  resetRepaymentsDetailPanels();

  await refreshAll();
}

async function refreshAll(){
  // Load the normal application data first. The Admin-only global EMI ledger
  // is loaded lazily only when its dedicated tab is opened, so it never
  // participates in Dashboard rendering.
  await Promise.all([loadMembers(),loadContributions(),loadLoans(),loadInstallments()]);
  renderAdminLoanCards();
  renderMemberRepayments();
  renderMetrics();
  renderReport();
  calculate();
}

async function loadMembers(){
  const {data,error} = await client.from('members').select('id,member_code,full_name,status,monthly_contribution,role,auth_user_id').order('member_code');
  if(error) return toast(error.message);
  members = data || [];
  const actionsHead=$('membersActionsHead');
  if(actionsHead) actionsHead.classList.toggle('hidden',!isAdmin);
  $('membersBody').innerHTML = members.map(m=>`<tr>
    <td>${esc(m.member_code)}</td><td>${esc(m.full_name)}</td><td>${esc(m.status)}</td>
    <td>${money(m.monthly_contribution)}</td>
    <td>${isAdmin ? `<select class="role-select" aria-label="Change role for ${esc(m.member_code)}" data-member-id="${esc(m.id)}" data-original-role="${esc(m.role)}"><option value="member" ${m.role==='member'?'selected':''}>Member</option><option value="admin" ${m.role==='admin'?'selected':''}>Admin</option></select>` : `<span class="role-badge role-${esc(m.role)}">${esc(m.role)}</span>`}</td>
    <td>${m.auth_user_id?'Linked':'Not linked'}</td>
    ${isAdmin ? `<td class="actions"><button class="small action-btn edit" onclick="editMember('${m.id}')">Edit</button><button class="small action-btn delete" onclick="deleteMember('${m.id}')">Delete</button></td>` : ''}
  </tr>`).join('') || `<tr><td colspan="${isAdmin?7:6}">No records</td></tr>`;
  if(isAdmin){
    $('membersBody').querySelectorAll('.role-select').forEach(el=>{
      el.addEventListener('change',()=>changeMemberRole(el));
    });
  }
}

async function changeMemberRole(select){
  const memberId = select.dataset.memberId;
  const previousRole = select.dataset.originalRole;
  const newRole = select.value;
  if(!memberId || !['admin','member'].includes(newRole)) return;
  if(newRole===previousRole) return;

  select.disabled = true;
  const {error} = await client.rpc('set_member_role', {p_member_id: memberId, p_role: newRole});
  if(error){
    select.value = previousRole;
    select.disabled = false;
    return toast(error.message);
  }

  select.dataset.originalRole = newRole;
  select.disabled = false;
  const roleMember = members.find(x=>x.id===memberId);
  const notification = await notifyMemberChange(memberId,'member_role_updated',{
    member_name:roleMember?.full_name||'',
    member_code:roleMember?.member_code||'',
    new_role:newRole
  });
  toast(notification.ok ? `Role changed to ${newRole}.` : `Role changed to ${newRole}. Email notification could not be sent.`);

  // If an Admin changes their own role, switch this browser to the new
  // permissions immediately. Other users receive the new role on their next
  // authenticated request/page refresh.
  if(currentMember?.id === memberId){
    await enterApp();
    return;
  }
  await loadMembers();
}

async function loadContributions(){
  const {data,error} = await client.from('contributions')
    .select('*,members(member_code,full_name)')
    .order('contribution_month',{ascending:false});
  if(error){
    contributions=[];
    $('contribBody').innerHTML=`<tr><td colspan="${isAdmin?7:6}">${esc(error.message)}</td></tr>`;
    return;
  }
  contributions=data||[];
  const actionsHead=$('contribActionsHead');
  if(actionsHead) actionsHead.classList.toggle('hidden',!isAdmin);
  $('contribBody').innerHTML=contributions.map(c=>`<tr>
    <td>${esc(displayMemberCode(c.members?.member_code,c.members?.full_name))} — ${esc(c.members?.full_name)}</td><td>${dateText(c.contribution_month)}</td>
    <td>${money(c.amount)}</td><td>${esc(c.status)}</td><td>${dateText(c.paid_date)}</td><td>${esc(c.transaction_ref||'—')}</td>
    ${isAdmin ? `<td class="actions"><button class="small action-btn edit" onclick="editContribution('${c.id}')">Edit</button><button class="small action-btn delete" onclick="deleteContribution('${c.id}')">Delete</button></td>` : ''}
  </tr>`).join('')||`<tr><td colspan="${isAdmin?7:6}">No contributions recorded</td></tr>`;
}

async function loadLoans(){
  const {data,error} = await client.from('loans').select('*,members(member_code,full_name)').order('created_at',{ascending:false});
  if(error){ $('loansBody').innerHTML=`<tr><td colspan="${isAdmin?9:8}">${esc(error.message)}</td></tr>`; return; }
  loans=data||[];
  const actionsHead=$('loansActionsHead');
  if(actionsHead) actionsHead.classList.toggle('hidden',!isAdmin);
  $('loansBody').innerHTML=loans.map(l=>{
    const rate=Number(l.monthly_rate);
    const e=validMonthlyRate(rate) ? emi(Number(l.principal),rate,Number(l.tenure_months)) : 0;
    const statusText = l.status === 'closed' && l.closed_at ? `${esc(l.status)} (${dateText(l.closed_at)})` : esc(l.status);
    return `<tr><td>${esc(l.loan_code)}</td><td>${esc(displayMemberCode(l.members?.member_code,l.members?.full_name))} — ${esc(l.members?.full_name)}</td>
      <td>${money(l.principal)}</td><td>${displayRate(rate)}</td><td>${l.tenure_months}</td><td>${validMonthlyRate(rate)?money(e):'<span class="message">Invalid rate</span>'}</td><td>${statusText}</td>
      <td><button class="small" onclick="showSchedule('${l.id}')">View</button></td>
      ${isAdmin ? `<td class="actions"><button class="small action-btn edit" onclick="editLoan('${l.id}')">Edit</button><button class="small action-btn delete" onclick="deleteLoan('${l.id}')">Delete</button></td>` : ''}</tr>`;
  }).join('')||`<tr><td colspan="${isAdmin?9:8}">No loans recorded</td></tr>`;
}

async function loadInstallments(){
  const {data,error}=await client.from('loan_installments')
    .select('*,loans(loan_code,member_id,members(member_code,full_name))')
    .order('loan_id').order('installment_no');
  if(error){ installments=[]; return toast(error.message); }
  installments=data||[];
}

async function loadAllEMIDetails(selectedLoanCode=''){
  const body=$('allEmiBody');
  const filter=$('allEmiLoanFilter');
  if(!body) return;

  // Build the loan-number filter from the same loans already loaded by the app.
  // Admins can choose any loan; members can choose only their own loan(s).
  const visibleLoans = isAdmin
    ? loans.slice()
    : loans.filter(l=>currentMember && l.member_id===currentMember.id);

  const loanCodes=[...new Set(visibleLoans.map(l=>String(l.loan_code||'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));

  if(filter){
    const current=selectedLoanCode || filter.value || '';
    filter.innerHTML=`<option value="">All Loans</option>` + loanCodes.map(code=>
      `<option value="${esc(code)}" ${code===current?'selected':''}>${esc(code)}</option>`
    ).join('');
    if(current && !loanCodes.includes(current)) filter.value='';
  }

  let data=[];

  if(isAdmin){
    // Admin keeps using the existing protected SECURITY DEFINER RPC.
    const {data:rpcData,error} = await client.rpc('admin_get_all_emi_details');
    if(error){
      body.innerHTML=`<tr><td colspan="7">${esc(error.message)}</td></tr>`;
      return;
    }
    data=rpcData||[];
  }else{
    // Members read only repayment rows allowed by the existing member RLS
    // policy, restricted further to their own loan IDs in the UI.
    const myLoanIds=visibleLoans.map(l=>l.id);
    if(!myLoanIds.length){
      body.innerHTML='<tr><td colspan="7">No EMI payments recorded for your loan(s).</td></tr>';
      return;
    }
    const {data:memberData,error}=await client.from('repayments')
      .select('id,loan_id,payment_date,total_amount,principal_component,interest_component,created_at')
      .in('loan_id',myLoanIds)
      .order('payment_date',{ascending:false})
      .order('created_at',{ascending:false});
    if(error){
      body.innerHTML=`<tr><td colspan="7">${esc(error.message)}</td></tr>`;
      return;
    }
    const loanMap=new Map(visibleLoans.map(l=>[l.id,l.loan_code]));
    data=(memberData||[]).map(r=>({...r,loan_code:loanMap.get(r.loan_id)||'—'}));
  }

  if(selectedLoanCode){
    data=data.filter(r=>String(r.loan_code||'')===String(selectedLoanCode));
  }

  const actionsHead=$('allEmiActionsHead');
  if(actionsHead) actionsHead.classList.toggle('hidden',!isAdmin);
  const colspan=isAdmin?7:6;

  body.innerHTML=data.map(r=>`<tr><td><strong>${esc(r.loan_code||'—')}</strong></td><td>${dateText(r.payment_date)}</td>
    <td>${money(r.total_amount)}</td><td>${money(r.principal_component)}</td><td>${money(r.interest_component)}</td>
    <td>${dateText(r.created_at)}</td>${isAdmin?`<td class="actions"><button class="small action-btn edit" onclick="editRepayment('${r.id}')">Edit</button><button class="small action-btn delete" onclick="deleteRepayment('${r.id}')">Delete</button></td>`:''}</tr>`
  ).join('')||`<tr><td colspan="${colspan}">${selectedLoanCode?'No EMI payments recorded for this loan.':'No repayments recorded'}</td></tr>`;
}

function renderMemberRepayments(){
  const panel=$('memberRepaymentPanel');
  const body=$('memberRepaymentBody');
  if(!panel || !body) return;

  // Never expose this member-only ledger to Admin. Admin already has the
  // complete repayment and loan-installment views above.
  if(isAdmin){
    panel.classList.add('hidden');
    body.innerHTML='';
    return;
  }

  // Members should use the Active Loans / Closed Loans cards as the
  // entry point, just like Admin. Do not automatically open the full
  // repayment ledger when the Repayments tab is loaded. The loan-level
  // EMI ledger remains available through the View action on a loan.
  panel.classList.add('hidden');

  if(!currentMember){
    body.innerHTML='<tr><td colspan="10">Member details are unavailable.</td></tr>';
    return;
  }

  // The loans/loan_installments collections are already restricted by RLS.
  // Filter again by the authenticated member's own member_id so the UI never
  // renders another member's ledger even if the page state is stale.
  const myLoans=loans.filter(l=>l.member_id===currentMember.id);
  const myLoanIds=new Set(myLoans.map(l=>l.id));
  const myInstallments=installments
    .filter(x=>myLoanIds.has(x.loan_id))
    .sort((a,b)=>{
      const loanA=myLoans.find(l=>l.id===a.loan_id);
      const loanB=myLoans.find(l=>l.id===b.loan_id);
      return String(loanA?.loan_code||'').localeCompare(String(loanB?.loan_code||'')) || a.installment_no-b.installment_no;
    });

  if(!myLoans.length){
    body.innerHTML='<tr><td colspan="10">No loan has been recorded for your account.</td></tr>';
    return;
  }

  if(!myInstallments.length){
    body.innerHTML='<tr><td colspan="10">Your loan repayment schedule is not available yet. Please contact Admin.</td></tr>';
    return;
  }

  body.innerHTML=myInstallments.map(x=>{
    const loan=myLoans.find(l=>l.id===x.loan_id);
    const status=String(x.status||'pending').toLowerCase();
    const statusClass=status==='paid'?'status-paid':'status-pending';
    return `<tr>
      <td><strong>${esc(loan?.loan_code||'—')}</strong></td>
      <td>${x.installment_no}</td>
      <td>${dateText(x.due_date)}</td>
      <td>${money(x.opening_balance)}</td>
      <td>${money(x.emi_amount)}</td>
      <td>${money(x.interest_component)}</td>
      <td>${money(x.principal_component)}</td>
      <td>${money(x.closing_balance)}</td>
      <td><span class="repayment-status ${statusClass}">${esc(status)}</span></td>
      <td>${dateText(x.paid_date)}</td>
    </tr>`;
  }).join('');
}

function loanStatus(l){
  return String(l?.status || '').trim().toLowerCase();
}

function nextPendingInstallment(loanId){
  return installments
    .filter(x=>x.loan_id===loanId && String(x.status||'pending').toLowerCase()!=='paid')
    .sort((a,b)=>a.installment_no-b.installment_no)[0] || null;
}

function effectiveLoanStatus(l){
  const status=loanStatus(l);
  if(status==='closed') return 'closed';

  // The EMI ledger is also used as a source of truth for older loans.
  // If every EMI is paid, the loan must not remain in Active Loans.
  const rows=installments.filter(x=>x.loan_id===l.id);
  if(rows.length>0 && !nextPendingInstallment(l.id)) return 'closed';

  return status;
}

function activeLoans(){
  // Active loans must have at least one unpaid/pending EMI.
  return loans.filter(l=>
    ['approved','active'].includes(loanStatus(l)) &&
    !!nextPendingInstallment(l.id)
  );
}

function closedLoans(){
  return loans.filter(l=>effectiveLoanStatus(l)==='closed');
}

function finalPaidInstallment(loanId){
  return installments
    .filter(x=>x.loan_id===loanId && String(x.status||'').toLowerCase()==='paid')
    .sort((a,b)=>b.installment_no-a.installment_no)[0] || null;
}

function repaymentViewLoans(){
  // The Active/Closed loan cards are available to both roles, but members
  // must only see loans belonging to their own fund account. Admin retains
  // the complete fund-wide view.
  if(isAdmin) return loans.slice();
  return loans.filter(l=>currentMember && l.member_id===currentMember.id);
}

function renderAdminLoanCards(){
  const visible=repaymentViewLoans();
  const active=visible.filter(l=>effectiveLoanStatus(l)!=='closed' && ['approved','active'].includes(loanStatus(l)) && !!nextPendingInstallment(l.id));
  const closed=visible.filter(l=>effectiveLoanStatus(l)==='closed');
  if($('activeLoansCount')) $('activeLoansCount').textContent=active.length;
  if($('closedLoansCount')) $('closedLoansCount').textContent=closed.length;
  // Keep the current list rendering compatible with both Admin and Member.
  renderAdminLoanList('active');
}

function renderAdminLoanList(type){
  const panel=$('adminLoanListPanel');
  if(!panel) return;
  const isActive=type==='active';
  const visible=repaymentViewLoans();
  const rowsLoans=isActive
    ? visible.filter(l=>['approved','active'].includes(loanStatus(l)) && !!nextPendingInstallment(l.id))
    : visible.filter(l=>effectiveLoanStatus(l)==='closed');
  $('adminLoanListTitle').textContent=isActive?'Active Loans':'Closed Loans';
  $('adminLoanListHint').textContent=isActive
    ? 'Showing all active loans with their overall scheduled interest and next pending EMI.'
    : 'Showing closed loans with their final recorded EMI details. Click View to see the complete paid EMI history.';

  // Active loans show the next pending EMI amount while Occurring Interest
  // and Total Amount remain the full scheduled loan totals.
  // Closed loans intentionally mirror the field names used in Reports →
  // Loan Details, with one additional View button for the complete EMI history.
  const headers=isActive
    ? ['Loan Issued','Loan No','Loan Amount','Tenure','Monthly EMI','Occurring Interest','Total Amount','Loan Status','View']
    : ['Loan Issued','Loan No','Loan Amount','Tenure','EMI','Interest Paid','Total Amount','Loan Status','View'];
  const headerEls=['adminLoanH1','adminLoanH2','adminLoanH3','adminLoanH4','adminLoanH5','adminLoanH6','adminLoanH7','adminLoanH8','adminLoanH9'];
  headerEls.forEach((id,i)=>{
    const el=$(id);
    if(!el) return;
    el.textContent=headers[i] || '';
    el.classList.toggle('hidden',!headers[i]);
  });

  const rows=rowsLoans.map(l=>{
    if(isActive){
      const x=nextPendingInstallment(l.id);
      const rate=Number(l.monthly_rate);
      const monthlyEmi=validMonthlyRate(rate)
        ? emi(Number(l.principal),rate,Number(l.tenure_months))
        : (x ? Number(x.emi_amount) : 0);
      // Occurring Interest is the TOTAL interest scheduled for the entire loan,
      // not the interest component of the next pending EMI. It must remain
      // unchanged as individual EMIs are paid. The complete installment
      // schedule is the source of truth for a reducing-balance loan.
      const loanInstallments=installments.filter(i=>i.loan_id===l.id);
      const overallInterest=loanInstallments.length
        ? loanInstallments.reduce((sum,i)=>sum+Number(i.interest_component||0),0)
        : (validMonthlyRate(rate) ? Math.max(0, (monthlyEmi*Number(l.tenure_months))-Number(l.principal)) : 0);
      const totalAmount=loanInstallments.length
        ? loanInstallments.reduce((sum,i)=>sum+Number(i.emi_amount||0),0)
        : (validMonthlyRate(rate) ? monthlyEmi*Number(l.tenure_months) : 0);
      return `<tr>
        <td>${dateText(l.approval_date)}</td>
        <td><strong>${esc(l.loan_code)}</strong></td>
        <td>${money(l.principal)}</td>
        <td>${l.tenure_months} months</td>
        <td>${monthlyEmi ? money(monthlyEmi) : '—'}</td>
        <td>${loanInstallments.length || validMonthlyRate(rate) ? money(overallInterest) : '—'}</td>
        <td>${totalAmount ? money(totalAmount) : '—'}</td>
        <td><strong>Active</strong></td>
        <td><button class="small" onclick="showRepaymentLoan('${l.id}')">View</button></td>
      </tr>`;
    }

    // Use the same calculations as Reports: EMI from the loan terms,
    // Interest Paid and Total Amount from actual paid EMI ledger entries,
    // and Loan Status including the final closed date.
    const paidRows=installments.filter(x=>x.loan_id===l.id && x.status==='paid');
    const interestPaid=paidRows.reduce((sum,x)=>sum+Number(x.interest_component||0),0);
    const totalPaid=paidRows.reduce((sum,x)=>sum+Number(x.emi_amount||0),0);
    const rate=Number(l.monthly_rate);
    const monthlyEmi=validMonthlyRate(rate) ? emi(Number(l.principal),rate,Number(l.tenure_months)) : 0;
    const status=l.status==='closed' && l.closed_at
      ? `${esc(l.status)} (${dateText(l.closed_at)})`
      : esc(l.status);

    return `<tr>
      <td>${dateText(l.approval_date)}</td>
      <td><strong>${esc(l.loan_code)}</strong></td>
      <td>${money(l.principal)}</td>
      <td>${l.tenure_months} months</td>
      <td>${validMonthlyRate(rate)?money(monthlyEmi):'—'}</td>
      <td>${money(interestPaid)}</td>
      <td>${money(totalPaid)}</td>
      <td><strong>${status}</strong></td>
      <td><button class="small" onclick="showRepaymentLoan('${l.id}')">View</button></td>
    </tr>`;
  }).join('');

  $('adminLoanListBody').innerHTML=rows || `<tr><td colspan="${isActive?9:9}">No ${isActive?'active':'closed'} loans found.</td></tr>`;
}

let selectedRepaymentLoanId = null;

window.showRepaymentLoan = async id => {
  // Keep the selected loan tied to the authenticated user's visible loan
  // scope. Admin may view any loan; a member may view only their own loan.
  const l=repaymentViewLoans().find(x=>x.id===id);
  if(!l) return;

  selectedRepaymentLoanId = id;
  $('repaymentScheduleTitle').textContent=`${l.loan_code} — ${l.members?.full_name||''}`;
  $('repaymentScheduleBody').innerHTML='<tr><td colspan="8">Loading this loan EMI ledger…</td></tr>';
  $('repaymentSchedulePanel').classList.remove('hidden');

  const {data,error}=await client.from('loan_installments')
    .select('*')
    .eq('loan_id',id)
    .order('installment_no');

  // If the user has clicked another loan while this request was running,
  // do not overwrite the newer selection.
  if(selectedRepaymentLoanId!==id) return;

  if(error){
    $('repaymentScheduleBody').innerHTML=`<tr><td colspan="8">${esc(error.message)}</td></tr>`;
    return;
  }

  $('repaymentScheduleBody').innerHTML=renderScheduleRows(data||[]);
};

if($('activeLoansCard')) $('activeLoansCard').onclick=()=>{ renderAdminLoanList('active'); $('adminLoanListPanel').classList.remove('hidden'); };
if($('closedLoansCard')) $('closedLoansCard').onclick=()=>{ renderAdminLoanList('closed'); $('adminLoanListPanel').classList.remove('hidden'); };
if($('closeAdminLoanList')) $('closeAdminLoanList').onclick=()=>$('adminLoanListPanel').classList.add('hidden');
if($('closeRepaymentSchedule')) $('closeRepaymentSchedule').onclick=()=>{ selectedRepaymentLoanId=null; $('repaymentSchedulePanel').classList.add('hidden'); };

function resetRepaymentsDetailPanels(){
  selectedRepaymentLoanId=null;
  if($('repaymentSchedulePanel')) $('repaymentSchedulePanel').classList.add('hidden');
  if($('adminLoanListPanel')) $('adminLoanListPanel').classList.add('hidden');
}


async function renderMetrics(){
  // Section 1: GLOBAL fund-level figures.
  // These values must be identical for every authenticated member and admin.
  // They are loaded through a SECURITY DEFINER RPC because normal member RLS
  // intentionally limits direct table reads to the logged-in member's records.
  const {data:fund,error} = await client.rpc('get_global_fund_metrics');
  if(error){
    $('metrics').innerHTML=`<div class="panel fund-metrics-error">Unable to load global fund totals. Please run the Phase 5 global fund metrics SQL migration in Supabase.</div>`;
    console.error('Global fund metrics error:',error);
  }else{
    // get_global_fund_metrics() RETURNS TABLE, so Supabase returns an array.
    // Use the first row before reading the metric column names.
    const globalFund = Array.isArray(fund) ? fund[0] : fund;

    const paidContributions = Number(globalFund?.total_fund_collected || 0);
    const borrowedFund = Number(globalFund?.borrowed_fund_by_members || 0);
    // The database RPC already includes all collected loan interest in the
    // Current Fund Balance. Keep the dashboard UI unchanged at exactly
    // three fund tiles.
    const currentFundBalance = Number(globalFund?.current_fund_balance_of_members || 0);

    console.log('Global fund metrics:', globalFund);

    $('metrics').innerHTML=[
      ['Total Fund Collected by All Members',money(paidContributions),'fund-card-collected'],
      ['Borrowed Fund By Members',money(borrowedFund),'fund-card-borrowed'],
      ['Current Fund Balance of Members',money(currentFundBalance),'fund-card-balance']
    ].map(([label,value,cls])=>`<div class="card fund-card ${cls}"><span>${label}</span><strong>${value}</strong></div>`).join('');
  }

  // Section 2: figures specific to the logged-in member.
  if(!currentMember){
    $('memberDetails').innerHTML='<p class="muted">Member details are unavailable.</p>';
    return;
  }

  const memberPaidContributions = contributions
    .filter(c=>c.member_id===currentMember.id && c.status==='paid');

  const contributionCount = memberPaidContributions.length;
  const fixedContribution = Number(currentMember.monthly_contribution || 1000);
  const memberTotalAmount = fixedContribution * contributionCount;

  const memberLoanAmountIssued = loans
    .filter(l=>l.member_id===currentMember.id && l.status!=='default')
    .reduce((sum,l)=>sum+Number(l.principal||0),0);

  $('memberDetails').innerHTML=`
    <div class="member-detail-item">
      <span>Fixed Contribution</span>
      <strong>${money(fixedContribution)} / month</strong>
    </div>
    <div class="member-detail-item">
      <span>No. of Contributions</span>
      <strong>${contributionCount}</strong>
    </div>
    <div class="member-detail-item">
      <span>Total Amount</span>
      <strong>${money(memberTotalAmount)}</strong>
      <small>${money(fixedContribution)} × ${contributionCount} contribution${contributionCount===1?'':'s'}</small>
    </div>
    <div class="member-detail-item">
      <span>Loan Amount Issued</span>
      <strong>${money(memberLoanAmountIssued)}</strong>
    </div>`;
}

async function renderReport(){
  // Contribution Details: members see their own paid contributions; Admin sees
  // the overall paid contribution total because Admin has global visibility.
  const paid=(contributions||[])
    .filter(x=>x.status==='paid')
    .reduce((s,x)=>s+Number(x.amount||0),0);

  $('reportContributionCard').innerHTML=`
    <div class="card"><span>${isAdmin?'Total Paid Contributions':'Paid Contribution'}</span><strong>${money(paid)}</strong></div>`;

  // Loan Details are deliberately split for Admin: the Admin's own loan(s)
  // are shown separately from loans belonging to all other members.
  const {data:loanRows,error:loanError}=await client.from('loans')
    .select('id,loan_code,member_id,principal,monthly_rate,tenure_months,approval_date,status,closed_at,members(member_code,full_name)')
    .order('created_at',{ascending:false});

  if(loanError){
    $('reportMyLoansBody').innerHTML=`<tr><td colspan="8">${esc(loanError.message)}</td></tr>`;
    if($('reportOverallLoansBody')) $('reportOverallLoansBody').innerHTML='';
    return;
  }

  const visibleLoans=loanRows||[];
  const loanIds=visibleLoans.map(l=>l.id);
  let repaymentRows=[];
  if(loanIds.length){
    const {data:rs,error:repaymentError}=await client.from('repayments')
      .select('loan_id,total_amount,interest_component,principal_component,payment_date')
      .in('loan_id',loanIds);
    if(repaymentError){
      $('reportMyLoansBody').innerHTML=`<tr><td colspan="8">${esc(repaymentError.message)}</td></tr>`;
      if($('reportOverallLoansBody')) $('reportOverallLoansBody').innerHTML='';
      return;
    }
    repaymentRows=rs||[];
  }

  const renderLoanRows = rows => rows.map(l=>{
    const repayments=repaymentRows.filter(r=>r.loan_id===l.id);
    const interestPaid=repayments.reduce((s,r)=>s+Number(r.interest_component||0),0);
    const totalPaid=repayments.reduce((s,r)=>s+Number(r.total_amount||0),0);
    const rate=Number(l.monthly_rate);
    const monthlyEmi=validMonthlyRate(rate) ? emi(Number(l.principal),rate,Number(l.tenure_months)) : 0;
    const status=l.status==='closed' && l.closed_at
      ? `${esc(l.status)} (${dateText(l.closed_at)})`
      : esc(l.status);

    return `<tr>
      <td>${dateText(l.approval_date)}</td>
      <td>${esc(l.loan_code)}</td>
      <td>${money(l.principal)}</td>
      <td>${l.tenure_months} months</td>
      <td>${validMonthlyRate(rate)?money(monthlyEmi):'—'}</td>
      <td>${money(interestPaid)}</td>
      <td>${money(totalPaid)}</td>
      <td><strong>${status}</strong></td>
    </tr>`;
  }).join('');

  const ownLoans=visibleLoans.filter(l=>l.member_id===currentMember?.id);
  const otherLoans=visibleLoans.filter(l=>l.member_id!==currentMember?.id);

  $('reportMyLoansBody').innerHTML=renderLoanRows(ownLoans)||'<tr><td colspan="8">No loans recorded for you.</td></tr>';

  if(isAdmin){
    $('reportOverallLoansSection').classList.remove('hidden');
    $('reportOverallLoansBody').innerHTML=renderLoanRows(otherLoans)||'<tr><td colspan="8">No other member loans recorded.</td></tr>';
  }else{
    $('reportOverallLoansSection').classList.add('hidden');
    $('reportOverallLoansBody').innerHTML='';
  }
}

function calculate(){
  const p=Number($('calcAmount').value)||0,n=Number($('calcMonths').value)||1,r=.01;
  const e=emi(p,r,n), total=e*n;
  $('calcResults').innerHTML=[['Monthly EMI',money(e)],['Total repayment',money(total)],['Total interest',money(total-p)]]
    .map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('');
}

function renderScheduleRows(rowsForLoan){
  const rows = [...rowsForLoan].sort((a,b)=>a.installment_no-b.installment_no);
  if(!rows.length) return '<tr><td colspan="8">EMI ledger not generated yet. Run the ledger SQL migration.</td></tr>';

  const totalInterest=rows.reduce((s,x)=>s+Number(x.interest_component||0),0);
  const totalPrincipal=rows.reduce((s,x)=>s+Number(x.principal_component||0),0);
  const totalPayment=rows.reduce((s,x)=>s+Number(x.emi_amount||0),0);
  const paidCount=rows.filter(x=>x.status==='paid').length;

  const body=rows.map(x=>`<tr>
    <td>${x.installment_no}</td><td>${dateText(x.due_date)}</td><td>${money(x.opening_balance)}</td>
    <td>${money(x.emi_amount)}</td><td>${money(x.interest_component)}</td><td>${money(x.principal_component)}</td>
    <td>${money(x.closing_balance)}</td><td><strong>${esc(x.status)}</strong>${x.paid_date?`<br><small>${dateText(x.paid_date)}</small>`:''}</td>
  </tr>`).join('');

  return body + `<tr class="total-row"><td colspan="3"><strong>TOTAL</strong></td>
    <td><strong>${money(totalPayment)}</strong></td><td><strong>${money(totalInterest)}</strong></td>
    <td><strong>${money(totalPrincipal)}</strong></td><td><strong>${money(rows.at(-1).closing_balance)}</strong></td><td><strong>${paidCount}/${rows.length} PAID</strong></td></tr>
    <tr class="summary-row"><td colspan="8"><strong>Total Repayment: ${money(totalPayment)} • Paid: ${paidCount} / ${rows.length} EMIs</strong></td></tr>`;
}

function scheduleIntegrityMessage(loan, rows){
  if(!loan || !rows.length) return '';
  const rate=Number(loan.monthly_rate);
  if(!validMonthlyRate(rate)) return '<div class=\"message loan-data-warning\"><strong>Loan rate data needs repair.</strong> The database contains a monthly rate above 10%. Do not record another EMI until the rate and ledger are corrected in Supabase.</div>';
  const expected=emi(Number(loan.principal),rate,Number(loan.tenure_months));
  const actual=Number(rows[0]?.emi_amount||0);
  if(Math.abs(expected-actual)>0.05) return `<div class=\"message loan-data-warning\"><strong>EMI ledger mismatch.</strong> Expected EMI at ${displayRate(rate)} is ${money(expected)}, but the stored ledger starts at ${money(actual)}. Repair the ledger before recording the next payment.</div>`;
  return '';
}

function scheduleRows(loan){
  // Used by the Loans tab. It is still restricted to this exact loan.
  return renderScheduleRows(installments.filter(x=>x.loan_id===loan.id));
}
window.showSchedule = id => {
  const l=loans.find(x=>x.id===id); if(!l)return;
  $('scheduleTitle').textContent=`${l.loan_code} — ${l.members?.full_name||''}`;
  $('scheduleBody').innerHTML=scheduleRows(l);
  const warning=scheduleIntegrityMessage(l, installments.filter(x=>x.loan_id===l.id));
  const existing=$('schedulePanel').querySelector('.loan-data-warning');
  if(existing) existing.remove();
  if(warning) $('schedulePanel').insertAdjacentHTML('afterbegin',warning);
  $('schedulePanel').classList.remove('hidden');
};
$('closeSchedule').onclick=()=>$('schedulePanel').classList.add('hidden');

function modal(title,html,submit){
  $('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modal').classList.remove('hidden');
  $('modalClose').onclick=closeModal;
  $('formModal').onsubmit=async e=>{e.preventDefault();await submit(new FormData(e.target));};
}
function closeModal(){$('modal').classList.add('hidden');}
function memberOptions(){return members.map(m=>`<option value="${m.id}">${esc(displayMemberCode(m.member_code,m.full_name))} — ${esc(m.full_name)}</option>`).join('');}


async function requireAdmin(){
  if(!isAdmin){ toast('Only an Admin can perform this action.'); return false; }
  return true;
}

async function notifyMemberChange(memberId, activity, details={}){
  try{
    const {data,error}=await client.functions.invoke('resend-email',{
      body:{member_id:memberId, activity, details}
    });
    if(error) return {ok:false,error:error.message||'Notification failed'};
    if(data && data.sent===false) return {ok:false,error:data.message||'Notification was not sent'};
    return {ok:true};
  }catch(error){
    return {ok:false,error:error?.message||'Notification failed'};
  }
}

function notificationWarning(notification){
  const reason=notification?.error ? ` Reason: ${notification.error}` : '';
  return `, but the email notification could not be sent${reason}`;
}

function nextLoanCodePreview(){
  const max=loans.reduce((highest,l)=>{
    const match=String(l?.loan_code||'').match(/^L(\d+)$/i);
    return match ? Math.max(highest,Number(match[1])) : highest;
  },0);
  return `L${String(max+1).padStart(2,'0')}`;
}

window.editMember=async id=>{
  if(!await requireAdmin()) return;
  const m=members.find(x=>x.id===id); if(!m)return;
  modal('Edit member',`<form id="formModal" class="form">
    <label>Member code<input name="member_code" value="${esc(m.member_code)}" required></label>
    <label>Full name<input name="full_name" value="${esc(m.full_name)}" required></label>
    <label>Monthly contribution<input name="monthly_contribution" type="number" min="1" step="0.01" value="${Number(m.monthly_contribution||0)}" required></label>
    <label>Status<select name="status"><option value="active" ${m.status==='active'?'selected':''}>Active</option><option value="inactive" ${m.status==='inactive'?'selected':''}>Inactive</option><option value="pending" ${m.status==='pending'?'selected':''}>Pending</option></select></label>
    <p class="muted">Role is managed separately using the Admin ↔ Member role dropdown.</p>
    <button class="primary">Save changes</button></form>`,async f=>{
      const {error}=await client.rpc('admin_update_member',{p_member_id:id,p_member_code:f.get('member_code'),p_full_name:f.get('full_name'),p_monthly_contribution:Number(f.get('monthly_contribution')),p_status:f.get('status')});
      if(error)return toast(error.message);
      const notification=await notifyMemberChange(id,'member_updated',{
        member_code:f.get('member_code'), member_name:f.get('full_name'),
        monthly_contribution:Number(f.get('monthly_contribution')), status:f.get('status')
      });
      closeModal();await refreshAll();toast(notification.ok ? 'Member updated successfully.' : 'Member updated successfully, but the email notification could not be sent.');
    });
};

window.deleteMember=async id=>{
  if(!await requireAdmin()) return;
  const m=members.find(x=>x.id===id); if(!m)return;
  if(!confirm(`Delete member ${m.member_code} — ${m.full_name}?\n\nMembers with contribution or loan records cannot be deleted.`)) return;
  const {error}=await client.rpc('admin_delete_member',{p_member_id:id});
  if(error)return toast(error.message);
  await refreshAll();toast('Member deleted successfully.');
};

window.editContribution=async id=>{
  if(!await requireAdmin()) return;
  const c=contributions.find(x=>x.id===id); if(!c)return;
  modal('Edit contribution',`<form id="formModal" class="form">
    <label>Member<select disabled>${memberOptions().replace(`value="${c.member_id}"`,`value="${c.member_id}" selected`)}</select></label>
    <label>Contribution month<input name="contribution_month" type="date" value="${esc(c.contribution_month||'')}" required></label>
    <label>Amount<input name="amount" type="number" min="0.01" step="0.01" value="${Number(c.amount||0)}" required></label>
    <label>Status<select name="status"><option value="paid" ${c.status==='paid'?'selected':''}>Paid</option><option value="pending" ${c.status==='pending'?'selected':''}>Pending</option></select></label>
    <label>Paid date<input name="paid_date" type="date" value="${esc(c.paid_date||'')}"></label>
    <label>Transaction reference<input name="transaction_ref" value="${esc(c.transaction_ref||'')}"></label>
    <button class="primary">Save changes</button></form>`,async f=>{
      const {error}=await client.rpc('admin_update_contribution',{p_id:id,p_contribution_month:f.get('contribution_month'),p_amount:Number(f.get('amount')),p_status:f.get('status'),p_paid_date:f.get('paid_date')||null,p_transaction_ref:f.get('transaction_ref')||null});
      if(error)return toast(error.message);
      const notification=await notifyMemberChange(c.member_id,'contribution_updated',{
        member_name:c.members?.full_name||members.find(m=>m.id===c.member_id)?.full_name||'',
        member_code:c.members?.member_code||members.find(m=>m.id===c.member_id)?.member_code||'',
        contribution_month:f.get('contribution_month'), amount:Number(f.get('amount')),
        status:f.get('status'), paid_date:f.get('paid_date')||null, transaction_ref:f.get('transaction_ref')||null
      });
      closeModal();await refreshAll();toast(notification.ok ? 'Contribution updated successfully.' : 'Contribution updated successfully, but the email notification could not be sent.');
    });
};

window.deleteContribution=async id=>{
  if(!await requireAdmin()) return;
  const c=contributions.find(x=>x.id===id); if(!c)return;
  if(!confirm(`Delete this contribution of ${money(c.amount)} for ${dateText(c.contribution_month)}?\n\nThis action cannot be undone.`)) return;
  const {error}=await client.rpc('admin_delete_contribution',{p_id:id});
  if(error)return toast(error.message);
  const member=members.find(m=>m.id===c.member_id);
  const notification=await notifyMemberChange(c.member_id,'contribution_deleted',{member_name:member?.full_name||'',member_code:member?.member_code||'',contribution_month:c.contribution_month,amount:Number(c.amount||0),status:c.status});
  await refreshAll();toast(notification.ok ? 'Contribution deleted successfully.' : `Contribution deleted successfully${notificationWarning(notification)}.`);
};

window.editLoan=async id=>{
  if(!await requireAdmin()) return;
  const l=loans.find(x=>x.id===id); if(!l)return;
  modal('Edit loan',`<form id="formModal" class="form">
    <label>Member<select disabled>${memberOptions().replace(`value="${l.member_id}"`,`value="${l.member_id}" selected`)}</select></label>
    <label>Loan code<input name="loan_code" value="${esc(l.loan_code)}" required></label>
    <label>Principal<input name="principal" type="number" min="1" step="0.01" value="${Number(l.principal||0)}" required></label>
    <label>Monthly rate<select name="monthly_rate" required>${Array.from({length:11},(_,i)=>`<option value="${(i/100).toFixed(2)}" ${Math.abs(Number(l.monthly_rate)-(i/100))<0.000001?'selected':''}>${i}%</option>`).join('')}</select></label>
    <label>Tenure (months)<input name="tenure_months" type="number" min="1" max="120" value="${Number(l.tenure_months||1)}" required></label>
    <label>Approval date<input name="approval_date" type="date" value="${esc(l.approval_date||'')}" required></label>
    <label>Status<select name="status"><option value="approved" ${l.status==='approved'?'selected':''}>Approved</option><option value="active" ${l.status==='active'?'selected':''}>Active</option><option value="closed" ${l.status==='closed'?'selected':''}>Closed</option></select></label>
    <label>Closed date<input name="closed_at" type="date" value="${esc(l.closed_at||'')}"></label>
    <p class="muted">If this loan already has repayments, principal/rate/tenure/approval date cannot be changed because those values drive the EMI ledger.</p>
    <button class="primary">Save changes</button></form>`,async f=>{
      const {error}=await client.rpc('admin_update_loan',{p_id:id,p_loan_code:f.get('loan_code'),p_principal:Number(f.get('principal')),p_monthly_rate:Number(f.get('monthly_rate')),p_tenure_months:Number(f.get('tenure_months')),p_approval_date:f.get('approval_date'),p_status:f.get('status'),p_closed_at:f.get('closed_at')||null});
      if(error)return toast(error.message);
      const notification=await notifyMemberChange(l.member_id,'loan_updated',{
        member_name:l.members?.full_name||members.find(m=>m.id===l.member_id)?.full_name||'', member_code:l.members?.member_code||members.find(m=>m.id===l.member_id)?.member_code||'',
        loan_code:f.get('loan_code'), principal:Number(f.get('principal')), monthly_rate:Number(f.get('monthly_rate')), tenure_months:Number(f.get('tenure_months')),
        approval_date:f.get('approval_date'), status:f.get('status'), closed_at:f.get('closed_at')||null, monthly_emi:emi(Number(f.get('principal')),Number(f.get('monthly_rate')),Number(f.get('tenure_months')))
      });
      closeModal();await refreshAll();toast(notification.ok ? 'Loan updated successfully.' : `Loan updated successfully${notificationWarning(notification)}.`);
    });
};

window.deleteLoan=async id=>{
  if(!await requireAdmin()) return;
  const l=loans.find(x=>x.id===id); if(!l)return;
  if(!confirm(`Delete loan ${l.loan_code} for ${l.members?.full_name||'member'}?\n\nA loan with recorded repayments cannot be deleted.`)) return;
  const {error}=await client.rpc('admin_delete_loan',{p_id:id});
  if(error)return toast(error.message);
  const notification=await notifyMemberChange(l.member_id,'loan_deleted',{member_name:l.members?.full_name||'',member_code:l.members?.member_code||'',loan_code:l.loan_code,principal:Number(l.principal||0),monthly_rate:Number(l.monthly_rate||0),tenure_months:Number(l.tenure_months||0)});
  await refreshAll();toast(notification.ok ? 'Loan deleted successfully.' : `Loan deleted successfully${notificationWarning(notification)}.`);
};

window.editRepayment=async id=>{
  if(!await requireAdmin()) return;
  const {data,error}=await client.from('repayments').select('*,loans(loan_code)').eq('id',id).maybeSingle();
  if(error)return toast(error.message); if(!data)return toast('Repayment not found.');
  modal('Edit EMI repayment',`<form id="formModal" class="form">
    <label>Loan<input value="${esc(data.loans?.loan_code||'—')}" disabled></label>
    <label>Amount<input value="${money(data.total_amount)}" disabled></label>
    <label>Principal<input value="${money(data.principal_component)}" disabled></label>
    <label>Interest<input value="${money(data.interest_component)}" disabled></label>
    <label>Payment date<input name="payment_date" type="date" value="${esc(data.payment_date||'')}" required></label>
    <p class="muted">Only the payment date can be edited. EMI amount, principal and interest remain tied to the installment ledger.</p>
    <button class="primary">Save changes</button></form>`,async f=>{
      const {error}=await client.rpc('admin_update_repayment',{p_id:id,p_payment_date:f.get('payment_date')});
      if(error)return toast(error.message);
      const repaymentLoan=loans.find(l=>l.id===data.loan_id);
      const notification=await notifyMemberChange(repaymentLoan?.member_id,'repayment_updated',{
        member_name:repaymentLoan?.members?.full_name||'',member_code:repaymentLoan?.members?.member_code||'',
        loan_code:data.loans?.loan_code||repaymentLoan?.loan_code||'',payment_date:f.get('payment_date'),amount:Number(data.total_amount||0),
        principal_component:Number(data.principal_component||0),interest_component:Number(data.interest_component||0)
      });
      closeModal();await refreshAll();toast(notification.ok ? 'Repayment updated successfully.' : `Repayment updated successfully${notificationWarning(notification)}.`);
    });
};

window.deleteRepayment=async id=>{
  if(!await requireAdmin()) return;
  const {data,error}=await client.from('repayments').select('id,payment_date,total_amount,loan_id,installment_id,loans(loan_code)').eq('id',id).maybeSingle();
  if(error)return toast(error.message); if(!data)return toast('Repayment not found.');
  if(!confirm(`Delete the repayment of ${money(data.total_amount)} for ${data.loans?.loan_code||'this loan'}?\n\nThe linked EMI will be returned to Pending and the loan will be reopened if it was closed.`)) return;
  const {error:deleteError}=await client.rpc('admin_delete_repayment',{p_id:id});
  if(deleteError)return toast(deleteError.message);
  const repaymentLoan=loans.find(l=>l.id===data.loan_id);
  const notification=await notifyMemberChange(repaymentLoan?.member_id,'repayment_deleted',{member_name:repaymentLoan?.members?.full_name||'',member_code:repaymentLoan?.members?.member_code||'',loan_code:data.loans?.loan_code||repaymentLoan?.loan_code||'',payment_date:data.payment_date,amount:Number(data.total_amount||0),principal_component:Number(data.principal_component||0),interest_component:Number(data.interest_component||0)});
  await refreshAll();toast(notification.ok ? 'Repayment deleted and the linked EMI was returned to Pending.' : `Repayment deleted and the linked EMI was returned to Pending${notificationWarning(notification)}.`);
};

$('addMemberBtn').onclick=()=>modal('Add member',`
<form id="formModal" class="form"><label>Member code<input name="member_code" required placeholder="M004"></label>
<label>Full name<input name="full_name" required></label><label>Monthly contribution<input name="monthly_contribution" type="number" value="1000" required></label>
<label>Status<select name="status"><option>active</option><option>inactive</option></select></label>
<button class="primary">Create member</button></form>`,async f=>{
  const {error}=await client.from('members').insert({member_code:f.get('member_code'),full_name:f.get('full_name'),monthly_contribution:Number(f.get('monthly_contribution')),status:f.get('status'),role:'member'});
  if(error) return toast(error.message);closeModal();refreshAll();
});

$('addContributionBtn').onclick=()=>modal('Record contribution',`
<form id="formModal" class="form"><label>Member<select name="member_id">${memberOptions()}</select></label>
<label>Contribution month<input name="contribution_month" type="date" required></label><label>Amount<input name="amount" type="number" value="1000" required></label>
<label>Paid date<input name="paid_date" type="date"></label><label>Transaction reference<input name="transaction_ref"></label>
<button class="primary">Save contribution</button></form>`,async f=>{
  const memberId=f.get('member_id');
  const contributionPayload={member_id:memberId,contribution_month:f.get('contribution_month'),amount:Number(f.get('amount')),paid_date:f.get('paid_date')||null,transaction_ref:f.get('transaction_ref')||null,status:f.get('paid_date')?'paid':'pending'};
  const {error}=await client.from('contributions').insert(contributionPayload);
  if(error)return toast(error.message);
  const member=members.find(m=>m.id===memberId);
  const notification=await notifyMemberChange(memberId,'contribution_created',{member_name:member?.full_name||'',member_code:member?.member_code||'',...contributionPayload});
  closeModal();await refreshAll();toast(notification.ok ? 'Contribution recorded successfully.' : `Contribution recorded successfully${notificationWarning(notification)}.`);
});

$('addLoanBtn').onclick=()=>{
  const preview=nextLoanCodePreview();
  modal('Create loan',`
<form id="formModal" class="form"><label>Member<select name="member_id">${memberOptions()}</select></label>
<label>Loan Number<input value="${esc(preview)}" readonly><small class="muted">Automatically generated by the system.</small></label><label>Principal<input name="principal" type="number" min="1" required></label>
<label>Monthly rate<select name="monthly_rate" required>
<option value="0.01" selected>1%</option>
<option value="0.02">2%</option><option value="0.03">3%</option><option value="0.04">4%</option>
<option value="0.05">5%</option><option value="0.06">6%</option><option value="0.07">7%</option>
<option value="0.08">8%</option><option value="0.09">9%</option><option value="0.10">10%</option>
</select></label><label>Tenure (months)<input name="tenure_months" type="number" min="1" max="120" value="12" required></label>
<label>Approval date<input name="approval_date" type="date" required></label><label>Status<select name="status"><option>approved</option><option>active</option></select></label>
<button class="primary">Create loan</button></form>`,async f=>{
  const rate=Number(f.get('monthly_rate'));
  if(!validMonthlyRate(rate)) return toast('Monthly rate must be between 0% and 10%.');
  const memberId=f.get('member_id');
  const principal=Number(f.get('principal'));
  const tenure=Number(f.get('tenure_months'));
  const approvalDate=f.get('approval_date');
  const status=f.get('status');
  const {data,error}=await client.rpc('admin_create_loan',{p_member_id:memberId,p_principal:principal,p_monthly_rate:rate,p_tenure_months:tenure,p_approval_date:approvalDate,p_status:status});
  if(error)return toast(error.message);
  const createdLoan=Array.isArray(data)?data[0]:data;
  const member=members.find(m=>m.id===memberId);
  const notification=await notifyMemberChange(memberId,'loan_created',{
    member_name:member?.full_name||'',member_code:member?.member_code||'',loan_code:createdLoan?.loan_code||preview,principal,monthly_rate:rate,tenure_months:tenure,approval_date:approvalDate,status,monthly_emi:emi(principal,rate,tenure)
  });
  closeModal();await refreshAll();toast(notification.ok ? `${createdLoan?.loan_code||preview} created successfully.` : `${createdLoan?.loan_code||preview} created successfully${notificationWarning(notification)}.`);
});
};

function loanTotals(loan){
  const p=Number(loan.principal), r=Number(loan.monthly_rate), n=Number(loan.tenure_months);
  const e=emi(p,r,n);
  let bal=p, interestTotal=0, principalTotal=0, paymentTotal=0;
  for(let i=1;i<=n;i++){
    const interest=bal*r;
    let principalPart=e-interest;
    let payment=e;
    if(i===n){ principalPart=bal; payment=principalPart+interest; }
    interestTotal += interest;
    principalTotal += principalPart;
    paymentTotal += payment;
    bal=Math.max(0,bal-principalPart);
  }
  return { total: paymentTotal, principal: principalTotal, interest: interestTotal };
}

function openInstallmentsForMember(memberId){
  return installments.filter(x=>x.loans?.member_id===memberId && x.status!=='paid')
    .sort((a,b)=>a.due_date.localeCompare(b.due_date) || a.installment_no-b.installment_no);
}

function fillRepaymentSummary(memberId){
  const loanSelect=$('repaymentLoan');
  const openInstallments=openInstallmentsForMember(memberId);
  const loanIds=[...new Set(openInstallments.map(x=>x.loan_id))];
  const openLoans=loans.filter(l=>loanIds.includes(l.id) && l.status!=='closed');
  loanSelect.innerHTML=openLoans.map(l=>`<option value="${l.id}">${esc(l.loan_code)} — ${esc(l.members?.full_name)}</option>`).join('');
  const loan=openLoans[0];
  if(!loan){
    ['repaymentInstallment','repaymentDue','repaymentTotal','repaymentPrincipal','repaymentInterest'].forEach(id=>{if($(id))$(id).value='';});
    $('repaymentStatusHint').textContent='No unpaid EMI found for this member.';
    return;
  }
  fillInstallmentSummary(loan.id);
}

function fillInstallmentSummary(loanId){
  const pending=installments.filter(x=>x.loan_id===loanId && x.status!=='paid').sort((a,b)=>a.installment_no-b.installment_no);
  const x=pending[0];
  const inst=$('repaymentInstallment');
  if(!x){
    if(inst)inst.innerHTML='';
    ['repaymentDue','repaymentTotal','repaymentPrincipal','repaymentInterest'].forEach(id=>{if($(id))$(id).value='';});
    $('repaymentStatusHint').textContent='All EMIs for this loan are already paid.';
    return;
  }
  if(inst) inst.innerHTML=pending.map(i=>`<option value="${i.id}">EMI #${i.installment_no} • Due ${dateText(i.due_date)} • ${esc(i.status)}</option>`).join('');
  $('repaymentDue').value=x.due_date;
  $('repaymentTotal').value=Number(x.emi_amount).toFixed(2);
  $('repaymentPrincipal').value=Number(x.principal_component).toFixed(2);
  $('repaymentInterest').value=Number(x.interest_component).toFixed(2);
  $('repaymentStatusHint').textContent=`Next EMI: #${x.installment_no} • ${dateText(x.due_date)} • ${money(x.closing_balance)} balance after payment`;
}

$('addRepaymentBtn').onclick=()=>{
  const eligible=activeLoans().filter(l=>nextPendingInstallment(l.id));
  modal('Record EMI repayment',`
  <form id="formModal" class="form">
    <label>Loan Number<select id="repaymentLoan" name="loan_id" required>
      ${eligible.map(l=>`<option value="${l.id}">${esc(l.loan_code)} — ${esc(l.members?.full_name)}</option>`).join('')}
    </select></label>
    <div id="repaymentStatusHint" class="muted"></div>
    <label>EMI Date<input id="repaymentDue" type="date" readonly></label>
    <label>EMI Amount<input id="repaymentTotal" type="number" step="0.01" readonly></label>
    <label>Principal Component<input id="repaymentPrincipal" type="number" step="0.01" readonly></label>
    <label>Interest Component<input id="repaymentInterest" type="number" step="0.01" readonly></label>
    <label>Payment Date<input name="payment_date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
    <p class="muted">The system automatically selects the first pending EMI. Only that installment will be marked paid.</p>
    ${eligible.length?'':'<p class="message">There are no active loans with pending EMIs.</p>'}
    <button class="primary" ${eligible.length?'':'disabled'}>Save EMI payment</button>
  </form>`,async f=>{
    const loanId=f.get('loan_id');
    const paymentDate=f.get('payment_date');
    if(!loanId || !paymentDate) return toast('Loan and payment date are required.');

    // Capture the exact loan and pending installment BEFORE the RPC changes
    // their status. This prevents the confirmation from ever referring to
    // the next EMI or showing an undefined loan number.
    const selectedLoan = loans.find(l=>l.id===loanId);
    const pendingBeforePayment = nextPendingInstallment(loanId);
    const selectedLoanCode = selectedLoan?.loan_code || loanId;
    const selectedInstallmentNo = pendingBeforePayment?.installment_no ?? '';

    // The database RPC is the source of truth: it locks the loan, selects
    // exactly the first pending installment, records one repayment, marks
    // only that installment paid, and closes the loan only after the final EMI.
    const {data,error}=await client.rpc('record_emi_payment',{
      p_loan_id:loanId,
      p_payment_date:paymentDate
    });
    if(error){
      console.error('record_emi_payment failed:',error);
      return toast(`EMI payment could not be saved: ${error.message||'Unknown error'}`);
    }

    // Support both current and older deployed RPC response shapes. The
    // selected loan/installment captured above are the final fallbacks.
    let result=data;
    if(typeof result==='string'){
      try{ result=JSON.parse(result); }catch(_){ result=null; }
    }

    const loanCode = result?.loan_code || selectedLoanCode;
    const installmentNo = result?.installment_no ?? selectedInstallmentNo;
    let savedLoanStatus = result?.loan_status || '';

    // Re-fetch the ledger before confirming success. This prevents the UI
    // from reporting success while still displaying the old EMI state.
    await loadInstallments();

    const savedInstallment=installments.find(x=>
      x.loan_id===loanId &&
      Number(x.installment_no)===Number(selectedInstallmentNo)
    );

    if(!savedInstallment ||
       String(savedInstallment.status||'').toLowerCase()!=='paid'){
      console.error('EMI payment was not confirmed in the ledger',{
        loanId,selectedInstallmentNo,savedInstallment,result
      });
      return toast('Payment was not confirmed in the EMI ledger. Please use View to verify before trying again.');
    }

    // If there is no pending EMI after the save, the loan is closed.
    if(!nextPendingInstallment(loanId)){
      savedLoanStatus='closed';
    }

    // Close and refresh immediately after the database save. Email delivery
    // must never block or hide a successful financial transaction.
    closeModal();
    await refreshAll();

    toast(savedLoanStatus==='closed'
      ? `${loanCode} is now CLOSED after the final EMI.`
      : `EMI #${installmentNo || selectedInstallmentNo || 'recorded'} recorded successfully for ${loanCode}.`);

    // Keep the existing member notification flow, but run it after the
    // payment confirmation so Brevo/Resend/network latency cannot affect
    // the financial save result.
    notifyMemberChange(selectedLoan?.member_id,'repayment_created',{
      member_name:selectedLoan?.members?.full_name||'',
      member_code:selectedLoan?.members?.member_code||'',
      loan_code:loanCode,
      installment_no:installmentNo,
      payment_date:paymentDate,
      amount:Number(result?.emi_amount ?? pendingBeforePayment?.emi_amount ?? 0),
      principal_component:Number(result?.principal_component ?? pendingBeforePayment?.principal_component ?? 0),
      interest_component:Number(result?.interest_component ?? pendingBeforePayment?.interest_component ?? 0),
      remaining_installments:result?.remaining_installments ?? null,
      loan_status:savedLoanStatus||''
    }).then(notification=>{
      if(!notification.ok){
        console.warn('Repayment notification failed:',notification.error);
      }
    }).catch(notificationError=>{
      console.warn('Repayment notification failed:',notificationError);
    });
  });

  if(!eligible.length) return;
  const loanSelect=$('repaymentLoan');
  const fill=()=>{
    const x=nextPendingInstallment(loanSelect.value);
    if(!x){
      $('repaymentDue').value='';$('repaymentTotal').value='';$('repaymentPrincipal').value='';$('repaymentInterest').value='';
      $('repaymentStatusHint').textContent='All EMIs for this loan are already paid.';
      return;
    }
    $('repaymentDue').value=x.due_date;
    $('repaymentTotal').value=Number(x.emi_amount).toFixed(2);
    $('repaymentPrincipal').value=Number(x.principal_component).toFixed(2);
    $('repaymentInterest').value=Number(x.interest_component).toFixed(2);
    $('repaymentStatusHint').textContent=`Next EMI: #${x.installment_no} • Due ${dateText(x.due_date)} • ${money(x.closing_balance)} balance after payment`;
  };
  loanSelect.onchange=fill;
  fill();
};
$('allEmiLoanFilter').onchange=async()=>{
  await loadAllEMIDetails($('allEmiLoanFilter').value);
};
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=async()=>{
  if(b.classList.contains('admin-only') && !isAdmin) return;

  const targetTab = b.dataset.tab;
  if(!targetTab || !$(targetTab)) return;

  // Repayment detail panels are strictly on-demand. Never leave an empty
  // ledger visible when the user enters or returns to the Repayments tab.
  resetRepaymentsDetailPanels();

  document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.tab').forEach(x=>x.classList.add('hidden'));
  $(targetTab).classList.remove('hidden');

  // Load the EMI transaction ledger when its dedicated tab is opened.
  if(targetTab==='allEmiDetails'){
    await loadAllEMIDetails();
  }
});
$('calcAmount').oninput=calculate;$('calcMonths').oninput=calculate;$('refreshBtn').onclick=refreshAll;
$('modalClose').onclick=closeModal;
$('logoutBtn').onclick=async()=>{await client.auth.signOut();showLogin();};

$('showSignupBtn').onclick=()=>{
  $('signupMessage').textContent='';
  setAuthView('signup');
};
$('backToLoginBtn').onclick=()=>{
  $('authMessage').textContent='';
  setAuthView('login');
};
$('forgotPasswordBtn').onclick=()=>{
  $('resetEmail').value=$('email').value.trim();
  $('resetMessage').textContent='';
  setAuthView('forgot');
};
$('backFromResetBtn').onclick=()=>{
  $('resetMessage').textContent='';
  setAuthView('login');
};

$('signInBtn').onclick=async()=>{
  const email=$('email').value.trim();
  const password=$('password').value;
  $('authMessage').textContent='Signing in...';
  if(!email || !password){$('authMessage').textContent='Please enter your email and password.';return;}
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error){$('authMessage').textContent=error.message;return;}
  await enterApp();
};

$('signUpBtn').onclick=async()=>{
  const fullName=$('signupFullName').value.trim();
  const email=$('signupEmail').value.trim();
  const password=$('signupPassword').value;
  const confirm=$('signupConfirmPassword').value;
  $('signupMessage').textContent='Creating your account...';

  if(fullName.length < 2){$('signupMessage').textContent='Please enter your full name.';return;}
  if(!email){$('signupMessage').textContent='Please enter your email address.';return;}
  if(password.length < 6){$('signupMessage').textContent='Password must be at least 6 characters.';return;}
  if(password!==confirm){$('signupMessage').textContent='Passwords do not match.';return;}

  const {data,error}=await client.auth.signUp({
    email,
    password,
    options:{
      data:{full_name:fullName},
      emailRedirectTo:authRedirectUrl()
    }
  });

  if(error){
    $('signupMessage').textContent=error.message;
    return;
  }

  $('signupFullName').value='';
  $('signupEmail').value='';
  $('signupPassword').value='';
  $('signupConfirmPassword').value='';

  if(data.session){
    await enterApp();
  }else{
    $('signupMessage').textContent='Account created successfully. Please check your email to confirm the account, then sign in.';
  }
};

$('sendResetBtn').onclick=async()=>{
  const email=$('resetEmail').value.trim();
  $('resetMessage').textContent='Sending reset link...';
  if(!email){$('resetMessage').textContent='Please enter your registered email address.';return;}
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:authRedirectUrl()});
  if(error){$('resetMessage').textContent=error.message;return;}
  $('resetMessage').textContent='If an account exists for this email, a password reset link has been sent. Please check your inbox.';
};

$('updatePasswordBtn').onclick=async()=>{
  const password=$('newPassword').value;
  const confirm=$('confirmNewPassword').value;
  $('newPasswordMessage').textContent='Updating password...';

  if(password.length < 6){
    $('newPasswordMessage').textContent='Password must be at least 6 characters.';
    return;
  }

  if(password!==confirm){
    $('newPasswordMessage').textContent='Passwords do not match.';
    return;
  }

  const {error}=await client.auth.updateUser({password});

  if(error){
    $('newPasswordMessage').textContent=error.message;
    return;
  }

  $('newPassword').value='';
  $('confirmNewPassword').value='';

  $('newPasswordMessage').textContent=
    'Password updated successfully. Please sign in with your new password.';

  setTimeout(async()=>{
    await client.auth.signOut();
    showLogin('login');
    $('authMessage').textContent=
      'Password updated successfully. Please sign in with your new password.';
  },700);
};

client.auth.onAuthStateChange(async(event)=>{
  /*
   * Password reset link clicked:
   * Supabase creates a temporary recovery session.
   * Show the existing password-reset screen.
   */
  if(event==='PASSWORD_RECOVERY'){
    showLogin('newPassword');
    $('newPasswordMessage').textContent=
      'Please enter your new password.';
  }
});

function toast(msg){alert(msg);}
calculate();init();

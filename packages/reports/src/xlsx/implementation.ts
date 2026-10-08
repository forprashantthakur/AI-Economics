import { layout, type Fmt, type WB } from './ctx';
import { colName } from './book';
import { fxf } from './assumptions';

export function buildImplementation(w: WB): void {
  const sh = w.s.impl;
  const plan = w.r.project.implementation;
  const impl = w.r.implementation;
  const b = w.book;
  w.title(sh, 'Implementation', 'Hours = effort × hours per day (when effort is in days). Cost = hours × cost rate; bill value = hours × bill rate. Fixed price = cost ÷ (1 − margin) × (1 − discount).');
  sh.width(1, 44);
  sh.freeze = { row: 3, col: 1 };

  let r = 4;
  w.section(sh, r++, 'Pricing inputs', 4);
  const scalar = (name: string, label: string, v: string | number, fmt: Fmt) => {
    w.label(sh, r, 1, label);
    w.input(sh, r, 2, v, fmt, name === 'ImplMethod' ? { list: ['cost_plus_margin', 'time_and_materials'] } : {});
    b.define(name, sh, r, 2);
    r++;
  };
  scalar('HoursPerDay', 'Hours per day', plan.hoursPerDay || 8, 'dec2');
  scalar('ContingencyPct', 'Contingency on labour + expenses', plan.contingencyPct, 'pct');
  scalar('ImplMarginPct', 'Target margin (cost plus margin)', plan.targetMarginPct, 'pct');
  scalar('ImplDiscountPct', 'Discount', plan.discountPct, 'pct');
  scalar('ImplMethod', 'Pricing method', plan.pricingMethod, 'text');
  r++;

  // Roles
  w.section(sh, r++, 'Rate card', 6);
  w.header(sh, r++, 1, ['Role', 'Role id', 'Cost rate', 'Bill rate', 'Currency', `Cost rate (${w.cur})`, `Bill rate (${w.cur})`]);
  const ro0 = r;
  for (const ro of plan.roles) {
    w.input(sh, r, 1, ro.name, 'text');
    w.input(sh, r, 2, ro.id, 'text');
    w.input(sh, r, 3, ro.costRate, 'money2');
    w.input(sh, r, 4, ro.billRate, 'money2');
    w.input(sh, r, 5, ro.currency, 'text');
    w.calc(sh, r, 6, `C${r}*${fxf(`$E${r}`)}`, 'money2');
    w.calc(sh, r, 7, `D${r}*${fxf(`$E${r}`)}`, 'money2');
    r++;
  }
  const ro1 = Math.max(ro0, r - 1);
  b.define('RoleIds', sh, ro0, 2, ro1, 2);
  b.define('RoleCost', sh, ro0, 6, ro1, 6);
  b.define('RoleBill', sh, ro0, 7, ro1, 7);
  r++;

  // Activities
  w.section(sh, r++, 'Activities', 16);
  const L = layout([
    { key: 'name', header: 'Activity' },
    { key: 'phase', header: 'Phase', width: 28 },
    { key: 'role', header: 'Role id', width: 12 },
    { key: 'effort', header: 'Effort', width: 10 },
    { key: 'unit', header: 'Unit', width: 9 },
    { key: 'hours', header: 'Hours', width: 11, check: true },
    { key: 'cr', header: 'Cost rate', width: 11 },
    { key: 'cost', header: 'Cost', width: 15, check: true },
    { key: 'br', header: 'Bill rate', width: 11 },
    { key: 'bill', header: 'Bill value', width: 15, check: true },
  ]);
  L.write(sh, w, r++);
  const c = L.col;
  const a0 = r;
  impl.activities.forEach((a, i) => {
    const src = plan.activities[i];
    w.input(sh, r, c.name, src.name, 'text');
    w.input(sh, r, c.phase, src.phase, 'text');
    w.input(sh, r, c.role, src.roleId, 'text');
    w.input(sh, r, c.effort, src.effort, 'count2');
    w.input(sh, r, c.unit, src.effortUnit, 'text', { list: ['hours', 'days'] });
    const E = (k: string) => `${colName(c[k])}${r}`;
    w.calc(sh, r, c.hours, `IF(${E('unit')}="days",${E('effort')}*HoursPerDay,${E('effort')})`, 'count2');
    w.check(sh, r, c.hours, a.hours, 'Implementation', `Hours — ${a.name}`, 'count2');
    w.calc(sh, r, c.cr, `IFERROR(INDEX(RoleCost,MATCH(${E('role')},RoleIds,0)),0)`, 'money2');
    w.calc(sh, r, c.cost, `${E('hours')}*${E('cr')}`, 'money');
    w.check(sh, r, c.cost, a.cost, 'Implementation', `Cost — ${a.name}`, 'money');
    w.calc(sh, r, c.br, `IFERROR(INDEX(RoleBill,MATCH(${E('role')},RoleIds,0)),0)`, 'money2');
    w.calc(sh, r, c.bill, `${E('hours')}*${E('br')}`, 'money');
    w.check(sh, r, c.bill, a.billValue, 'Implementation', `Bill value — ${a.name}`, 'money');
    r++;
  });
  const a1 = Math.max(a0, r - 1);
  const col = (k: string) => colName(c[k]);
  w.label(sh, r, 1, 'Total labour', 'total');
  w.total(sh, r, c.hours, `SUM(${col('hours')}${a0}:${col('hours')}${a1})`, 'count2');
  w.total(sh, r, c.cost, `SUM(${col('cost')}${a0}:${col('cost')}${a1})`, 'money');
  w.total(sh, r, c.bill, `SUM(${col('bill')}${a0}:${col('bill')}${a1})`, 'money');
  b.define('LaborHours', sh, r, c.hours);
  b.define('LaborCost', sh, r, c.cost);
  b.define('LaborBill', sh, r, c.bill);
  w.check(sh, r, c.hours, impl.laborHours, 'Implementation', 'Total labour hours', 'count2');
  w.check(sh, r, c.cost, impl.laborCost, 'Implementation', 'Total labour cost', 'money');
  r += 2;

  // Expenses
  w.section(sh, r++, 'Direct expenses', 6);
  w.header(sh, r++, 1, ['Expense', 'Amount', 'Currency', 'Billable', `Amount (${w.cur})`, 'Billable amount']);
  const e0 = r;
  for (const e of plan.directExpenses) {
    w.input(sh, r, 1, e.name, 'text');
    w.input(sh, r, 2, e.amount, 'money2');
    w.input(sh, r, 3, e.currency, 'text');
    w.input(sh, r, 4, e.billable ? 'Yes' : 'No', 'text', { list: ['Yes', 'No'] });
    w.calc(sh, r, 5, `B${r}*${fxf(`$C${r}`)}`, 'money');
    w.calc(sh, r, 6, `IF(D${r}="Yes",E${r},0)`, 'money');
    r++;
  }
  const e1 = Math.max(e0, r - 1);
  r++;

  // Price build-up
  w.section(sh, r++, 'Cost and price build-up', 5);
  w.header(sh, r++, 1, ['Line', 'Amount', 'Engine', 'Δ']);
  const line = (name: string, label: string, f: string, ev: Parameters<WB['check']>[3], fmt: 'money' | 'pct' = 'money') => {
    w.label(sh, r, 1, label);
    w.calc(sh, r, 2, f, fmt);
    b.define(name, sh, r, 2);
    w.check(sh, r, 2, ev, 'Implementation', label, fmt);
    r++;
  };
  line('ImplLabour', 'Labour cost', 'LaborCost', impl.laborCost);
  line('ImplExpenses', 'Direct expenses', `SUM(E${e0}:E${e1})`, impl.directExpenses);
  line('ImplBillableExp', 'Billable expenses', `SUM(F${e0}:F${e1})`, impl.billableExpenses);
  line('ImplContingency', 'Contingency', '(ImplLabour+ImplExpenses)*ContingencyPct/100', impl.contingency);
  line('ImplCost', 'Implementation cost', 'ImplLabour+ImplExpenses+ImplContingency', impl.totalCost);
  line('ImplTM', 'Time and materials value', 'LaborBill+ImplBillableExp', impl.tmValue);
  line('ImplCPM', 'Fixed price (cost ÷ (1 − margin))', 'IF(ImplCost=0,0,ImplCost/(1-ImplMarginPct/100))', impl.cpmPrice);
  line('ImplPrice', 'Quoted price (after discount)', 'IF(ImplMethod="time_and_materials",ImplTM,ImplCPM)*(1-ImplDiscountPct/100)', impl.price);
  line('ImplGP', 'Gross profit', 'ImplPrice-ImplCost', impl.grossProfit);
  line('ImplMarginOut', 'Gross margin %', 'IF(ImplPrice=0,0,(ImplPrice-ImplCost)/ImplPrice*100)', impl.marginPct, 'pct');
  r++;
  w.note(sh, r, 1, `Schedule: ${impl.durationWeeks} weeks on the critical path (engine value — computed from activity dependencies).`);
}

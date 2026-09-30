import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseCsv,toCsv} from '../src/csv.js';
import {reconcile} from '../src/reconcile.js';

const O=(category,minutes,extras={})=>({rowNumber:2,source:'test-oee.csv',date:'2026-01-12',line:'Линия А',shift:'day',master:'Мастер 1',category,minutes:String(minutes),accounted_minutes:'480',note:'',...extras});
const A=(category,total,extras={})=>({rowNumber:2,source:'test-acts.csv',date:'2026-01-12',line:'Линия А',shift:'day',master:'Мастер 1',category,start:'10:00',end:'10:30',total_downtime_minutes:String(total),repair_minutes:'5',reason:'',...extras});
const groups=(o,a,options)=>reconcile(o,a,options).counts;

test('учебные CSV дают все шесть групп и ссылки на физические строки',async()=>{
  const o=parseCsv(await fs.readFile(new URL('../demo/oee.csv',import.meta.url),'utf8')).map(r=>({...r,source:'oee.csv'}));
  const a=parseCsv(await fs.readFile(new URL('../demo/acts.csv',import.meta.url),'utf8')).map(r=>({...r,source:'acts.csv'}));
  const report=reconcile(o,a);
  assert.deepEqual(report.counts,{minute_mismatch:1,oee_without_act:1,act_without_oee:1,category_error:1,balance_outside:1,night_dispute:1});
  assert.equal(report.issues.length,6);
  assert.equal(report.issues.find(i=>i.group==='minute_mismatch').delta,-8);
  assert.deepEqual(report.issues.find(i=>i.group==='minute_mismatch').sourceRows,[{source:'oee.csv',rowNumber:2},{source:'acts.csv',rowNumber:2}]);
});
test('сравнение берёт общее время простоя, не минуты ремонта',()=>{
  const result=groups([O('mechanical',30)],[A('mechanical',30)]);
  assert.equal(result.minute_mismatch,0);
});
test('стандартная операция без акта не ошибка, стандартная категория с актом требует проверки',()=>{
  assert.equal(groups([O('standard_wash',25)],[]).oee_without_act,0);
  const result=groups([O('standard_other',30,{note:'Настройка'})],[A('process',30,{reason:'Настройка'})]);
  assert.equal(result.category_error,1);assert.equal(result.act_without_oee,0);
});
test('незаполненный конец акта виден в замечаниях',()=>{
  const result=reconcile([O('mechanical',30)],[A('mechanical',30,{end:''})]);
  assert.equal(result.counts.category_error,1);
  assert.match(result.issues[0].title,/времени/);
});
test('фильтр линии исключает другие линии, допуск баланса учитывает границу',()=>{
  const rows=[O('mechanical',20,{accounted_minutes:'465'}),O('mechanical',40,{line:'Линия Б',accounted_minutes:'400',rowNumber:3})];
  const result=reconcile(rows,[],{line:'Линия А'});
  assert.equal(result.checked.shifts,1);assert.equal(result.counts.balance_outside,0);
  assert.equal(groups([rows[0]],[],{tolerance:14}).balance_outside,1);
});
test('кавычки и запятая CSV сохраняются при разборе и выгрузке',()=>{
  const csv=toCsv([{name:'Тест, "А"',note:'две\nстроки'}],['name','note']);
  assert.equal(parseCsv(csv)[0].name,'Тест, "А"');
  assert.equal(parseCsv(csv)[0].note,'две\nстроки');
});

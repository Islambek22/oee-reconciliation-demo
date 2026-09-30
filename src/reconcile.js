export const GROUPS=[
  {id:'minute_mismatch',title:'Несовпадения минут',color:'red'},
  {id:'oee_without_act',title:'Простои без актов',color:'orange'},
  {id:'act_without_oee',title:'Акты без OEE',color:'gold'},
  {id:'category_error',title:'Ошибки категорий',color:'purple'},
  {id:'balance_outside',title:'Баланс за пределами ±15 минут',color:'blue'},
  {id:'night_dispute',title:'Спорные ночные смены',color:'slate'}
];
export const SHIFT_MINUTES=480;
const STANDARD=new Set(['standard_wash','standard_other']);
const CATEGORY={mechanical:'Механическая часть',electrical:'Электрическая часть',process:'Технологический процесс',standard_wash:'Стандартная мойка',standard_other:'Стандартное «Другое»'};
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const num=(x,label,row)=>{const n=Number(x);if(x===''||!Number.isFinite(n)||n<0)throw new Error(`Строка ${row}: неверное поле «${label}»`);return n;};
const key=r=>[r.date,r.line,r.shift].join('|');
const groupedKey=r=>[key(r),r.category].join('|');
const sameDescription=(left,right)=>{const a=String(left.note||'').trim().toLocaleLowerCase('ru'),b=String(right.reason||'').trim().toLocaleLowerCase('ru');return Boolean(a)&&a===b;};
const minutes=(start,end)=>{const [a,b]=[start,end].map(t=>{if(!/^\d{2}:\d{2}$/.test(t))return NaN;const [h,m]=t.split(':').map(Number);return h<24&&m<60?h*60+m:NaN;});return Number.isFinite(a+b)?(b-a+1440)%1440:NaN;};

export function validateAndPrepare(oee,acts){
  for(const [kind,rows,fields] of [['OEE',oee,['date','line','shift','master','category','minutes','accounted_minutes','note']],['Акт',acts,['date','line','shift','master','category','start','end','total_downtime_minutes','repair_minutes','reason']]]){
    for(const r of rows){for(const f of fields)if(!(f in r))throw new Error(`${kind}: нет столбца «${f}»`);
      if(!datePattern.test(r.date)||!['day','night'].includes(r.shift)||!r.line||!r.category)throw new Error(`${kind}, строка ${r.rowNumber}: проверьте дату, линию, смену и категорию`);
      if(!(r.category in CATEGORY))throw new Error(`${kind}, строка ${r.rowNumber}: неизвестная категория «${r.category}»`);
    }
  }
  const O=oee.map(r=>({...r,minutes:num(r.minutes,'minutes',r.rowNumber),accounted_minutes:num(r.accounted_minutes,'accounted_minutes',r.rowNumber)}));
  const A=acts.map(r=>{
    const total=num(r.total_downtime_minutes,'total_downtime_minutes',r.rowNumber);
    const repair=r.repair_minutes===''?null:num(r.repair_minutes,'repair_minutes',r.rowNumber);
    const calculated=minutes(r.start,r.end);
    return {...r,minutes:total,repairMinutes:repair,calculatedMinutes:calculated,crossesMidnight:Number.isFinite(calculated)&&r.end<r.start};
  });
  return {oee:O,acts:A};
}

function aggregate(rows){const map=new Map();for(const r of rows){const k=groupedKey(r);if(!map.has(k))map.set(k,{...r,minutes:0,sources:[]});const v=map.get(k);v.minutes+=r.minutes;v.sources.push(r);}return [...map.values()];}
function summarizeRows(rows){return rows.map(r=>`${r.source}:${r.rowNumber}`).join(', ');}

export function reconcile(oeeInput,actInput,{line='all',from='',to='',tolerance=15}={}){
  const {oee,acts}=validateAndPrepare(oeeInput,actInput);
  const inside=r=>(line==='all'||r.line===line)&&(!from||r.date>=from)&&(!to||r.date<=to);
  const O=oee.filter(inside),A=acts.filter(inside),issues=[];
  const issue=(group,title,why,action,left=[],right=[],delta=0)=>issues.push({id:`issue-${issues.length+1}`,group,title,why,action,line:left[0]?.line||right[0]?.line||'',date:left[0]?.date||right[0]?.date||'',shift:left[0]?.shift||right[0]?.shift||'',delta,oee:left,acts:right,sourceRows:[...left,...right].map(r=>({source:r.source,rowNumber:r.rowNumber}))});
  const oAgg=aggregate(O.filter(r=>!STANDARD.has(r.category))),standard=aggregate(O.filter(r=>STANDARD.has(r.category))),aAgg=aggregate(A);
  const used=new Set(),pending=[];
  for(const left of oAgg){const index=aAgg.findIndex((right,i)=>!used.has(i)&&groupedKey(left)===groupedKey(right));
    if(index<0){pending.push(left);continue;}
    used.add(index);const right=aAgg[index],delta=left.minutes-right.minutes;
    if(delta!==0)issue('minute_mismatch',`Разница ${Math.abs(delta)} мин`,`OEE ${left.minutes} мин; акты ${right.minutes} мин по категории «${CATEGORY[left.category]}».`,'Проверьте длительность актов и итог в колонке OEE.',left.sources,right.sources,delta);
  }
  for(const left of pending){const i=aAgg.findIndex((right,j)=>!used.has(j)&&key(left)===key(right)&&left.minutes===right.minutes&&sameDescription(left,right));
    if(i>=0){used.add(i);const right=aAgg[i];issue('category_error','Категории не совпадают',`OEE: «${CATEGORY[left.category]}» ${left.minutes} мин; акт: «${CATEGORY[right.category]}» ${right.minutes} мин.`,'Уточните фактическую категорию и исправьте первичную запись.',left.sources,right.sources);}
    else issue('oee_without_act','Для простоя не найден акт',`В OEE ${left.minutes} мин по категории «${CATEGORY[left.category]}».`,'Проверьте оформление и внесение акта.',left.sources);
  }
  for(const [i,right] of aAgg.entries())if(!used.has(i)){
    const reference=standard.find(left=>key(left)===key(right)&&left.minutes===right.minutes&&sameDescription(left,right));
    if(reference){used.add(i);issue('category_error','Простой указан как стандартная операция',`Общие минуты совпадают: ${right.minutes}. В OEE стоит «${CATEGORY[reference.category]}», в акте «${CATEGORY[right.category]}».`,'Проверьте категорию; не добавляйте эти минуты повторно.',reference.sources,right.sources);}
  }
  for(const [i,right] of aAgg.entries())if(!used.has(i))issue('act_without_oee','Акт не отражён в OEE',`В акте ${right.minutes} мин по категории «${CATEGORY[right.category]}».`,'Найдите строку OEE или уточните акт.',[],right.sources);
  const shiftRows=new Map();for(const r of O){const k=key(r);if(!shiftRows.has(k))shiftRows.set(k,[]);shiftRows.get(k).push(r);}
  for(const rows of shiftRows.values()){const totals=new Set(rows.map(r=>r.accounted_minutes));if(totals.size!==1)issue('category_error','Разные итоги одной смены','В строках OEE одной смены указаны разные значения accounted_minutes.','Сверьте общий итог смены в исходном OEE.',rows);
    else {const actual=rows[0].accounted_minutes; if(Math.abs(actual-SHIFT_MINUTES)>tolerance)issue('balance_outside',`Баланс ${actual-SHIFT_MINUTES>0?'+':''}${actual-SHIFT_MINUTES} мин`,`Учтено ${actual} мин при норме ${SHIFT_MINUTES} мин.`,'Проверьте распределение времени за смену.',rows,[],actual-SHIFT_MINUTES);}}
  for(const a of A){if(a.crossesMidnight)issue('night_dispute','Простой пересекает полночь',`Акт ${a.start}–${a.end}; дата смены ${a.date}.`,'Подтвердите производственную дату ночной смены.',[],[a]);
    if(!Number.isFinite(a.calculatedMinutes))issue('category_error','В акте нет корректного времени','Начало или окончание простоя отсутствует либо имеет неверный формат.','Заполните начало и окончание простоя в акте.',[],[a]);
    else if(Math.abs(a.calculatedMinutes-a.minutes)>1)issue('category_error','Длительность акта не совпадает со временем',`По времени ${a.calculatedMinutes} мин; поле общего простоя ${a.minutes} мин.`,'Проверьте начало, конец и общее время простоя.',[],[a]);}
  issues.sort((a,b)=>GROUPS.findIndex(g=>g.id===a.group)-GROUPS.findIndex(g=>g.id===b.group)||a.date.localeCompare(b.date));
  const counts=Object.fromEntries(GROUPS.map(g=>[g.id,issues.filter(i=>i.group===g.id).length]));
  return {issues,counts,checked:{oee:O.length,acts:A.length,shifts:shiftRows.size},categoryNames:CATEGORY,sourceSummary:summarizeRows([...O,...A])};
}

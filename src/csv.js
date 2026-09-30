// Small RFC 4180-style CSV reader. Keeps the physical source row for review.
export function parseCsv(source) {
  const input=String(source).replace(/^\uFEFF/,'');
  const records=[];let cells=[],cell='',quoted=false,row=1,recordRow=1;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(quoted){
      if(c==='"'&&input[i+1]==='"'){cell+='"';i++;}
      else if(c==='"')quoted=false;
      else {cell+=c;if(c==='\n')row++;}
    } else if(c==='"')quoted=true;
    else if(c===','){cells.push(cell);cell='';}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&input[i+1]==='\n')i++;
      cells.push(cell);if(cells.some(x=>x.trim()!==''))records.push({cells,row:recordRow});
      cells=[];cell='';row++;recordRow=row;
    } else cell+=c;
  }
  if(quoted)throw new Error(`Незакрытая кавычка в CSV, строка ${recordRow}`);
  cells.push(cell);if(cells.some(x=>x.trim()!==''))records.push({cells,row:recordRow});
  if(!records.length)throw new Error('CSV пустой');
  const headers=records.shift().cells.map(x=>x.trim());
  if(new Set(headers).size!==headers.length)throw new Error('В CSV повторяется название столбца');
  return records.map(record=>{
    if(record.cells.length!==headers.length)throw new Error(`Неверное число столбцов в строке ${record.row}`);
    return {rowNumber:record.row,...Object.fromEntries(headers.map((h,i)=>[h,record.cells[i].trim()]))};
  });
}

export function toCsv(rows,headers){
  const escape=value=>{const s=String(value??'');return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
  return '\uFEFF'+[headers.join(','),...rows.map(r=>headers.map(h=>escape(r[h])).join(','))].join('\r\n');
}

// Evaluation-only semantic aliases were frozen before calls. Never used to guide adoption.
import {protocol} from './cases.mjs';
import {digest} from './shared.mjs';
const canonicalName=x=>x.replace(/^ext_/,'').toLowerCase();
export function scoreRelated(rows,event){
  const selected=rows.filter(r=>r.sourceEventIds.includes(event.id)),predictions=[];
  for(const row of selected){
    const values=aliases=>Object.entries(row.fields).filter(([id,v])=>aliases.includes(id)&&v.state==='value').map(([,v])=>v.value);
    const quantity=values(protocol.equivalence.quantity),date=values(protocol.equivalence.date);
    if(protocol.equivalence.concept.includes(canonicalName(row.conceptId))&&quantity.length===1&&date.length===1&&row.parentReferences.length===1)predictions.push({reference:row.parentReferences[0],quantity:quantity[0],date:date[0]});
    else predictions.push({invalidLearnedRecord:row.conceptId});
  }
  const used=new Set();let correct=0;
  for(const p of predictions){const n=event.expected.findIndex((g,i)=>!used.has(i)&&digest(g)===digest(p));if(n>=0){used.add(n);correct++;}}
  return {correct,proposed:predictions.length,expected:event.expected.length,precision:predictions.length?correct/predictions.length:null,recall:event.expected.length?correct/event.expected.length:null,exact:correct===event.expected.length&&correct===predictions.length,predictions};
}
export function totalScores(rows){const sum=k=>rows.reduce((n,r)=>n+r[k],0),correct=sum('correct'),proposed=sum('proposed'),expected=sum('expected');return {events:rows.length,correct,proposed,expected,precision:proposed?correct/proposed:null,recall:expected?correct/expected:null,f1:proposed+expected?2*correct/(proposed+expected):1,exactEvents:rows.filter(r=>r.exact).length};}

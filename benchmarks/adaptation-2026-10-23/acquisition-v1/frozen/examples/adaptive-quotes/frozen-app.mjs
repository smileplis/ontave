// Frozen application. No delivery concept, field names, relation IDs or business-question aliases here.
import {frozenDefinition} from './shared.mjs';
export const queries=Object.freeze([
  {conceptId:'quotation',order:{field:'reference',direction:'asc'},limit:100},
  {conceptId:'quote_line',order:{field:'quantity',direction:'asc'},limit:100},
  {conceptId:'quotation',where:[{field:'reference',op:'eq',value:'Q17'}],limit:10},
]);
export function businessValues(records){return records.map(r=>({conceptId:r.conceptId,fields:Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[k,v.state==='value'?{state:v.state,value:v.value,verification:v.verification}:v.state==='conflict'?{state:v.state,values:v.candidates.map(c=>c.value)}:{state:v.state}]))}));}
export async function oldQueries(store){const result=[];for(const q of queries)result.push(await store.findFrozen(q));return result;}
// A generic related-record inspector is part of the frozen app. It renders runtime definitions.
export async function relatedCollections(store){return store.related('quotation');}
export const appDefinition=frozenDefinition;

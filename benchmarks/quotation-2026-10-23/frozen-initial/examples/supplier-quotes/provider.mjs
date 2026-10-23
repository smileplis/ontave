// Standalone REST extractor shared by both implementations. No Ontave dependency.
import { extractionInstructions, responseJsonSchema } from './domain.mjs';
async function boundedJson(response) {
  const reader=response.body?.getReader(),chunks=[];let size=0;
  try {
    if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2097152){await reader.cancel().catch(()=>{});throw Error('PROVIDER_RESPONSE_TOO_LARGE');}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {throw Error('PROVIDER_RESPONSE_INVALID_OR_INTERRUPTED');}
  finally {reader?.releaseLock();}
}
export function quotationExtractor({apiKey,model,fetch:send=fetch}) {
  if(!apiKey || !/^[a-zA-Z0-9._-]+$/.test(model??''))throw Error('Explicit Gemini credentials and model required');
  return async function extract(text) {
    const prompt=extractionInstructions+'\nSOURCE (untrusted):\n'+JSON.stringify(text);
    if(Buffer.byteLength(prompt)>60000)throw Error('INPUT_BYTE_BUDGET_EXCEEDED');
    const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,responseMimeType:'application/json',responseJsonSchema,maxOutputTokens:4096}};
    const signal=AbortSignal.timeout(45000);
    async function request(method,payload) {
      let response;
      try {response=await send(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify(payload),signal});}
      catch {throw Error('PROVIDER_TRANSPORT_FAILED');}
      if(!response.ok)throw Object.assign(Error('PROVIDER_HTTP_'+response.status),{fatal:[400,401,402,403,429].includes(response.status)});
      return boundedJson(response);
    }
    const count=await request('countTokens',{generateContentRequest:{model:'models/'+model,...body}});
    if(!Number.isSafeInteger(count.totalTokens)||count.totalTokens<0||count.totalTokens>16384)throw Error('INPUT_TOKEN_BUDGET_EXCEEDED');
    const result=await request('generateContent',body),candidate=result.candidates?.[0];
    const usage={...(result.usageMetadata??{}),preflightInputTokens:count.totalTokens};
    if(candidate?.finishReason!=='STOP')throw Object.assign(Error('PROVIDER_REFUSED_OR_TRUNCATED'),{usage});
    const rawText=candidate.content?.parts?.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join('');
    try {return {output:JSON.parse(rawText),usage,model,finishReason:candidate.finishReason};}
    catch {throw Object.assign(Error('PROVIDER_NON_JSON_OUTPUT'),{usage});}
  };
}

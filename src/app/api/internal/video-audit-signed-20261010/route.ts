import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';
export const runtime='nodejs';
export const maxDuration=120;

export async function GET(req:NextRequest) {
 if(process.env.VERCEL_ENV!=='preview' ||
    process.env.VERCEL_GIT_COMMIT_REF!=='research/openrouter-video-validation-20261010' ||
    Date.now()>Date.parse('2026-10-10T23:20:00Z')) return new Response('Not found',{status:404});
 const which=req.nextUrl.searchParams.get('case') || '';
 if(!['short-omni','medium-omni','short-qwen'].includes(which)) return NextResponse.json({error:'test_not_allowed'},{status:400});
 const key=process.env.OPENROUTER_API_KEY;
 if(!key) return NextResponse.json({error:'missing_openrouter_key'},{status:503});
 const storage=createServiceClient().storage.from('message-images');
 const path=`research-video-audit/${Date.now()}-${crypto.randomUUID()}.mp4`;
 let uploaded=false;
 try {
   const source=which==='medium-omni'
      ? 'https://storage.googleapis.com/cloud-samples-data/video/JaneGoodall.mp4'
      : 'https://samplelib.com/mp4/sample-5s-360p.mp4';
   const f=await fetch(source,{signal:AbortSignal.timeout(25000)});
   if(!f.ok) throw new Error('sample_download_http_'+f.status);
   const bytes=Buffer.from(await f.arrayBuffer());
   const size=bytes.byteLength;
   if(size<1000||size>35_000_000) throw new Error('sample_out_of_bounds_'+size);
   const up=await storage.upload(path,bytes,{contentType:'video/mp4',upsert:false});
   if(up.error) throw new Error('supabase_upload_'+up.error.message);
   uploaded=true;
   const sig=await storage.createSignedUrl(path,600);
   if(sig.error||!sig.data?.signedUrl) throw new Error('supabase_signed_url_failed');
   const url=sig.data.signedUrl;
   const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',
      signal:AbortSignal.timeout(85000),
      headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json','X-OpenRouter-Metadata':'enabled'},
      body:JSON.stringify({
        model:which.endsWith('omni')?'qwen/qwen3.8-omni-flash':'qwen/qwen3.8-flash',
        messages:[{role:'user',content:[
         {type:'text',text:'Describe at least two specific visible objects or events in this video. Report whether any intelligible spoken words are audible, and quote a short phrase if so; do not invent audio.'},
         {type:'video_url',video_url:{url}}
        ]}],
        max_completion_tokens:950,
        stream:false,
      }),
   });
   const raw=await response.text();let body:any={};
   try{body=JSON.parse(raw);}catch{}
   return NextResponse.json({
      case:which,
      ok:response.ok,
      status:response.status,
      model:body.model||null,
      provider:body.provider||null,
      response_text:String(body.choices?.[0]?.message?.content||'').slice(0,1400),
      finish_reason:body.choices?.[0]?.finish_reason||null,
      error:body.error?{code:body.error.code,message:String(body.error.message||'').slice(0,300),raw:String(body.error.metadata?.raw||'').slice(0,350)}:!response.ok?raw.slice(0,350):null,
      input_bytes:size,
      via_private_supabase_signed_url:true,
      usage:{
       cost:body.usage?.cost??null,
       input_tokens:body.usage?.prompt_tokens??null,
       video_tokens:body.usage?.prompt_tokens_details?.video_tokens??null,
      }
   },{status:response.ok?200:502});
 }catch(e){
   return NextResponse.json({case:which,ok:false,error:e instanceof Error?e.message:'unknown'}, {status:502});
 }finally{
   if(uploaded){
     const cleanup=await storage.remove([path]);
     if(cleanup.error) console.warn('[Research video probe] Temporary cleanup failed',cleanup.error.message);
   }
 }
}

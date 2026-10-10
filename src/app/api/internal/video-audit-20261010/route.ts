import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const maxDuration = 120;
const cases = new Set([
  'inline-studio','inline-vertex','inline-qwen',
  'url-qwen','youtube-priority','youtube-nitro'
]);
const SAMPLE = 'https://samplelib.com/mp4/sample-5s-360p.mp4';
const YOUTUBE = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
export async function GET(request: NextRequest) {
  // Short-lived, fixed-input diagnostics on a research-only preview branch.
  // This endpoint neither reads customer data nor accepts arbitrary URLs/models.
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.VERCEL_GIT_COMMIT_REF !== 'research/openrouter-video-validation-20261010' ||
      Date.now() > Date.parse('2026-10-10T23:20:00Z')) {
    return new Response('Not found', {status: 404});
  }
  const which=request.nextUrl.searchParams.get('case') || '';
  if (!cases.has(which)) return NextResponse.json({error:'not_an_allowed_test'},{status:400});
  const key=process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({error:'openrouter_key_unavailable'},{status:503});
  const inline=which.startsWith('inline-');
  const youtube=which.startsWith('youtube-');
  const model=which.includes('qwen') ? 'qwen/qwen3.8-flash' :
      which==='youtube-nitro' ? 'google/gemini-3.8-flash:nitro' : 'google/gemini-3.8-flash';
  const provider=which==='inline-vertex'
    ? {only:['google-vertex'],allow_fallbacks:false}
    : which.includes('studio') || youtube
      ? {only:['google-ai-studio'],allow_fallbacks:false} : undefined;
  try {
    let url = youtube ? YOUTUBE : SAMPLE;
    let bytes = 0;
    if(inline) {
      const file = await fetch(SAMPLE,{signal:AbortSignal.timeout(12000)});
      if(!file.ok) throw new Error('sample_fetch_http_'+file.status);
      const buf=Buffer.from(await file.arrayBuffer());
      bytes=buf.length;
      if(bytes<1000 || bytes>3_000_000) throw new Error('video_sample_size_out_of_bounds_'+bytes);
      url='data:video/mp4;base64,'+buf.toString('base64');
    }
    const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',
      signal:AbortSignal.timeout(85000),
      headers:{
        'Authorization':'Bearer '+key,
        'Content-Type':'application/json',
        'X-OpenRouter-Metadata':'enabled',
      },
      body:JSON.stringify({
        model,
        ...(provider?{provider}:{}),
        ...(which==='youtube-priority'?{service_tier:'priority'}:{}),
        messages:[{role:'user',content:[
          {type:'text',text:'Briefly describe the actual visual events in this video, mentioning at least two specific details visible in the frames. Do not guess.'},
          {type:'video_url',video_url:{url}}
        ]}],
        max_completion_tokens:900,
        stream:false
      }),
    });
    const raw=await response.text();
    let body:any={};
    try{body=JSON.parse(raw);}catch{}
    const usage=body.usage||{};
    return NextResponse.json({
      case:which,
      ok:response.ok,
      status:response.status,
      model:body.model||null,
      provider:body.provider||null,
      endpoint:body.openrouter_metadata?.provider_name||null,
      content:String(body.choices?.[0]?.message?.content||'').slice(0,800),
      finish_reason:body.choices?.[0]?.finish_reason||null,
      error:body.error?{
        code:body.error.code,
        message:String(body.error.message||'').slice(0,250),
        metadata:{
          provider_name:body.error.metadata?.provider_name,
          limit_source:body.error.metadata?.limit_source,
          provider_error_code:body.error.metadata?.provider_error_code,
          raw:String(body.error.metadata?.raw||'').slice(0,400),
        },
      }:!response.ok?raw.slice(0,400):null,
      input_bytes:bytes,
      usage:{
        video_tokens:usage.prompt_tokens_details?.video_tokens??null,
        cost:usage.cost??null,
        prompt_tokens:usage.prompt_tokens??null,
        completion_tokens:usage.completion_tokens??null,
      },
    },{status:response.ok?200:502});
  }catch(e){
    return NextResponse.json({
      case:which,
      ok:false,
      error:e instanceof Error?e.message:'unknown',
    },{status:502});
  }
}

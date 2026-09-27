const fs=require('fs');
const p='src/app/api/debate/route.ts';
let s=fs.readFileSync(p,'utf8');

if(!s.includes('const semanticSynthesisLookup =')){
  s=s.replace(
    /(const topicalOccurrenceLookup =[\s\S]*?jevEffectiveConstraints\?\.temporalRelation \|\| ''\n\s*\);)/,
    `$1

                  const semanticSynthesisLookup =
                    jevEffectiveConstraints?.semanticRole === 'find_topic' &&
                    jevEffectiveOperations.includes('rolling_summary') &&
                    jevEffectiveOperations.includes('semantic_history') &&
                    !jevEffectiveOperations.includes('chronology') &&
                    !jevEffectiveOperations.includes('speaker_filter');

                  const topicQualifiedSemanticLookup =
                    topicalOccurrenceLookup || semanticSynthesisLookup;`
  );
}

s=s.replace(
  /topicalOccurrenceLookup &&\n\s*retrievalQuery === semanticQuery/g,
  "topicQualifiedSemanticLookup &&\n                    retrievalQuery === semanticQuery"
);

s=s.replace(
  /const semanticCandidateLimit =\n\s*topicalOccurrenceLookup/g,
  "const semanticCandidateLimit =\n                    topicQualifiedSemanticLookup"
);

s=s.replace(
  /topicalOccurrenceLookup &&\n\s*selected\.length > 1/g,
  "topicQualifiedSemanticLookup &&\n                    selected.length > 1"
);

fs.writeFileSync(p,s);
console.log('Applied synthesis semantic qualification');

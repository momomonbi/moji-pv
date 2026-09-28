import sys
sp=sys.argv[1]
s=open(sp+'/design-wf.js',encoding='utf-8').read()
old="  (p) => agent(COMMON + `\\nYour package: ${p.key}"
assert s.count(old)==1, s.count(old)
new="  (p) => args && args.skipDesign ? Promise.resolve({ package: p.key, skipped: true }) : agent(COMMON + `\\nYour package: ${p.key}"
open(sp+'/design-wf2.js','w',encoding='utf-8').write(s.replace(old,new))

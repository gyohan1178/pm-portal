async function l(c,t=1e3){let r=[],a=0;for(;;){const{data:f,error:n}=await c().range(a,a+t-1);if(n)throw n;const o=f||[];if(r=r.concat(o),o.length<t)break;a+=t}return r}export{l as f};

export default function evaluatePolicyMatchesFn(
  policyMatches: PolicyMatch[],
  checkpoints: Checkpoints,
) {
  let verdict = 'unknown';

  let allowed = false;
  let rejected = false;
  let unreached = false;
  let exception = false;

  if (!checkpoints['client-out']) unreached = true;

  for (const { matches } of policyMatches) {
    for (const match of matches) {
      if (match.includes('ALLOW') || match.includes('ALLOWED'))
        allowed = true;
      if (
        match.includes('DENY') ||
        match.includes('DENIED') ||
        match.includes('REJECTED')
      )
        rejected = true;
      if (match.includes('exception')) exception = true;
    }
  }

  if (exception) verdict = 'exception';
  else if (rejected) verdict = 'rejected';
  else if (unreached) verdict = 'unreached';
  else if (allowed) verdict = 'allowed';
  else verdict = 'unknown';

  return verdict;
}

// import { useEffect, useState } from 'react';

// export default function useEvaluatePolicyMatches(
//   policyMatches: PolicyMatch[],
//   checkpoints: Checkpoints,
// ) {
//   const [verdict, setVerdict] = useState<
//     'allowed' | 'rejected' | 'unreached' | 'exception' | 'unknown'
//   >('unknown');

//   useEffect(() => {
//     let allowed = false;
//     let rejected = false;
//     let unreached = false;
//     let exception = false;

//     if (!checkpoints['client-out']) unreached = true;

//     for (const { matches } of policyMatches) {
//       for (const match of matches) {
//         if (match.includes('ALLOW') || match.includes('ALLOWED'))
//           allowed = true;
//         if (
//           match.includes('DENY') ||
//           match.includes('DENIED') ||
//           match.includes('REJECTED')
//         )
//           rejected = true;
//         if (match.includes('exception')) exception = true;
//       }
//     }

//     if (exception) setVerdict('exception');
//     else if (rejected) setVerdict('rejected');
//     else if (unreached) setVerdict('unreached');
//     else if (allowed) setVerdict('allowed');
//     else setVerdict('unknown');
//   }, [policyMatches]);

//   return verdict;
// }

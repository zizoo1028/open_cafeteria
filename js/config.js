/* 열린식당 설정
 * 여기 있는 키는 모두 웹페이지에 공개돼도 되는 키입니다.
 * - supabaseKey: Supabase publishable 키 (데이터 보호는 DB의 RLS 정책이 담당)
 * - kakaoJsKey: 카카오 JavaScript 키 (카카오 콘솔에 등록된 도메인에서만 동작)
 * 서버용 비밀 키(service_role, 카카오 REST API 키)는 절대 여기에 넣지 마세요.
 */
window.OC_CONFIG = {
  supabaseUrl: 'https://aufithqaacpjewkgnfrn.supabase.co',
  supabaseKey: 'sb_publishable_Tw4gaP9ojM0ESSSjC9zFHA_k7xCs6xL',
  kakaoJsKey: 'f993b05a99750ce8ccacef8eb6e889cb',
};

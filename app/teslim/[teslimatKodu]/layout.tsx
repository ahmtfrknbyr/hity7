/**
 * Teslimat ayrıntı sayfası müşteriye özeldir ve adresteki koda göre istek anında hazırlanır;
 * önceden (derleme sırasında) hazırlanamaz. Bu yüzden "bloklayan rota" olarak işaretlenir.
 */
export const instant = false;

export default function TeslimatLayout({ children }: { children: React.ReactNode }) {
  return children;
}

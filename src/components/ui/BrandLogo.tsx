import logo from "../../assets/gogo-security-logo.png";

/** The official Gogo Security logo (decorative next to the brand name). */
function BrandLogo({ large = false, className = "" }: { large?: boolean; className?: string }) {
  return <img src={logo} alt="" aria-hidden="true" className={`brand-logo${large ? " brand-logo--lg" : ""}${className ? ` ${className}` : ""}`} width={large ? 56 : 36} height={large ? 56 : 36} decoding="async" />;
}

export default BrandLogo;

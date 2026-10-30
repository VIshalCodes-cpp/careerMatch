import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();
  useEffect(() => { console.error("404 Error: User attempted to access non-existent route:", location.pathname); }, [location.pathname]);
  return <main className="shell flex min-h-[calc(100vh-76px)] items-center py-20"><div><p className="eyebrow">404 · Not found</p><h1 className="mt-5 font-display text-6xl font-semibold tracking-[-.07em]">That page moved.</h1><p className="mt-5 text-ink/55">The opportunity you’re looking for isn’t here.</p><Link to="/" className="button button-dark mt-8">Return home</Link></div></main>;
};
export default NotFound;

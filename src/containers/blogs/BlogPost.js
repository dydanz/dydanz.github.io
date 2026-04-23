import React, {useState, useEffect, useContext} from "react";
import {useParams, useHistory} from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Header from "../../components/header/Header";
import Footer from "../../components/footer/Footer";
import ScrollToTopButton from "../topbutton/Top";
import {StyleProvider} from "../../contexts/StyleContext";
import {useLocalStorage} from "../../hooks/useLocalStorage";
import blogManifest from "../../blogs/manifest";
import "./Blog.scss";
import StyleContext from "../../contexts/StyleContext";

function BlogPostContent() {
  const {slug} = useParams();
  const history = useHistory();
  const {isDark} = useContext(StyleContext);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  const post = blogManifest.find(p => p.slug === slug);

  useEffect(() => {
    if (!post) return;
    fetch(post.file)
      .then(res => res.text())
      .then(text => {
        setContent(text.replace(/^---[\s\S]*?---\n/, ""));
        setLoading(false);
      })
      .catch(() => {
        setContent("Failed to load post.");
        setLoading(false);
      });
  }, [post]);

  if (!post) {
    return (
      <div className="main">
        <p>Post not found.</p>
        <button className="blog-back-btn" onClick={() => history.push("/")}>← Back home</button>
      </div>
    );
  }

  return (
    <div className="main" style={{paddingTop: "80px"}}>
      <button
        className={isDark ? "blog-back-btn dark-mode" : "blog-back-btn"}
        onClick={() => history.push("/#blogs")}
      >
        ← Back to writing
      </button>
      <div className={isDark ? "blog-post-content dark-mode" : "blog-post-content"}>
        <p className="blog-post-meta">{post.date}</p>
        <h1 className="blog-post-title">{post.title}</h1>
        {loading ? <p>Loading...</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>}
      </div>
    </div>
  );
}

export default function BlogPost() {
  const darkPref = window.matchMedia("(prefers-color-scheme: dark)");
  const [isDark, setIsDark] = useLocalStorage("isDark", darkPref.matches);

  return (
    <div className={isDark ? "dark-mode" : null}>
      <StyleProvider value={{isDark, changeTheme: () => setIsDark(!isDark)}}>
        <Header />
        <BlogPostContent />
        <Footer />
        <ScrollToTopButton />
      </StyleProvider>
    </div>
  );
}

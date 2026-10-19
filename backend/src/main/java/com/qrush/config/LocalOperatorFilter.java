package com.qrush.config;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.net.URI;
import java.util.Set;

/** Local demonstration controls, intentionally not a production admin-auth system. */
@Component
public class LocalOperatorFilter extends OncePerRequestFilter {
    @Value("${qrush.operator.enabled:true}") private boolean enabled;
    private static final Set<String> LOCAL=Set.of("localhost","127.0.0.1","::1","[::1]","0:0:0:0:0:0:0:1");
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException {
        String path=request.getRequestURI();
        boolean mutation=!Set.of("GET","HEAD","OPTIONS").contains(request.getMethod());
        boolean operator=path.equals("/api/openings") || path.startsWith("/api/chaos/") || path.matches("/api/flows/[^/]+/(policy|scenario|load)(/stop)?") || path.matches("/api/pools/[^/]+/init");
        String origin=request.getHeader("Origin");
        boolean badOrigin=false;
        if(origin!=null) {try{String host=URI.create(origin).getHost();badOrigin=host==null || !LOCAL.contains(host);}catch(IllegalArgumentException e){badOrigin=true;}}
        if(mutation && (badOrigin || (operator && (!enabled || !LOCAL.contains(request.getRemoteAddr()))))){response.setStatus(403);response.setContentType("application/json");response.getWriter().write("{\"message\":\"Operator mutations are restricted to the enabled local demonstration environment.\"}");return;}
        response.setHeader("Referrer-Policy","no-referrer");
        response.setHeader("Cache-Control","no-store");
        chain.doFilter(request,response);
    }
}

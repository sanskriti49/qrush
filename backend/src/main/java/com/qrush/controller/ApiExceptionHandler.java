package com.qrush.controller;

import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import java.util.*;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(HttpMessageNotReadableException.class) public ResponseEntity<?> body(HttpMessageNotReadableException e){
        Throwable cause=e.getMostSpecificCause();
        String message=cause instanceof IllegalArgumentException ? cause.getMessage() : "The request body is invalid. Check required fields and supported values.";
        return error(HttpStatus.BAD_REQUEST,message);
    }
    @ExceptionHandler(IllegalArgumentException.class) public ResponseEntity<?> invalid(IllegalArgumentException e){return error(HttpStatus.BAD_REQUEST,e.getMessage());}
    @ExceptionHandler(NoSuchElementException.class) public ResponseEntity<?> missing(NoSuchElementException e){return error(HttpStatus.NOT_FOUND,e.getMessage());}
    @ExceptionHandler(ResponseStatusException.class) public ResponseEntity<?> status(ResponseStatusException e){return error(HttpStatus.valueOf(e.getStatusCode().value()),e.getReason());}
    @ExceptionHandler(DataAccessException.class) public ResponseEntity<?> dependency(DataAccessException e){return error(HttpStatus.SERVICE_UNAVAILABLE,"A storage dependency is unavailable. No success is assumed; retry with the same participant session.");}
    private ResponseEntity<?> error(HttpStatus status,String message){return ResponseEntity.status(status).body(Map.of("status",status.value(),"message",message==null?status.getReasonPhrase():message));}
}
